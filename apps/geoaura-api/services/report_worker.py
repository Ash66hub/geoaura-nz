import asyncio
import logging
import os
import socket
import time

from services.agent_service import AgentService
from services.supabase_service import SupabaseService

logger = logging.getLogger(__name__)


def _get_poll_seconds() -> int:
    raw = os.getenv("REPORT_WORKER_POLL_SECONDS", "5")
    try:
        return max(1, int(raw))
    except ValueError:
        return 5


def _get_worker_enabled() -> bool:
    return os.getenv("RUN_REPORT_WORKER") == "1"


def _get_requeue_after_seconds() -> int:
    raw = os.getenv("REPORT_REQUEUE_AFTER_SECONDS", "900")
    try:
        return max(60, int(raw))
    except ValueError:
        return 900


def _get_requeue_interval_seconds() -> int:
    raw = os.getenv("REPORT_REQUEUE_INTERVAL_SECONDS", "60")
    try:
        return max(10, int(raw))
    except ValueError:
        return 60


def _get_lock_seconds() -> int:
    raw = os.getenv("REPORT_LOCK_SECONDS", "120")
    try:
        return max(30, int(raw))
    except ValueError:
        return 120


async def report_worker_loop() -> None:
    logging.getLogger().setLevel(logging.INFO)
    logger.setLevel(logging.INFO)

    if not _get_worker_enabled():
        logger.info("WORKER: disabled (RUN_REPORT_WORKER != 1).")
        return

    supabase = SupabaseService()
    agent = AgentService()
    poll_seconds = _get_poll_seconds()
    requeue_after = _get_requeue_after_seconds()
    requeue_interval = _get_requeue_interval_seconds()
    lock_seconds = _get_lock_seconds()
    worker_id = os.getenv("REPORT_WORKER_ID") or f"{socket.gethostname()}:{os.getpid()}"
    next_requeue_at = time.monotonic() + requeue_interval
    current_report_id: str | None = None

    requeued = supabase.requeue_stale_processing_reports(requeue_after)
    if requeued:
        logger.info("WORKER: requeued %s stale processing reports: %s", len(requeued), ", ".join(requeued))

    logger.info("WORKER: started. Poll interval=%ss", poll_seconds)
    print(f"WORKER: started. Poll interval={poll_seconds}s")

    while True:
        try:
            queued_count = supabase.get_report_queue_depth(["QUEUED"])
            processing_count = supabase.get_report_queue_depth(["PROCESSING"])
            current_label = current_report_id or "none"
            logger.info(
                "WORKER: status - current=%s - queue=%s - processing=%s",
                current_label,
                queued_count,
                processing_count,
            )
            print(
                f"WORKER: status - current={current_label} - queue={queued_count} - processing={processing_count}"
            )

            if time.monotonic() >= next_requeue_at:
                requeued = supabase.requeue_stale_processing_reports(requeue_after)
                if requeued:
                    logger.info("WORKER: requeued %s stale processing reports: %s", len(requeued), ", ".join(requeued))
                    print(f"WORKER: requeued {len(requeued)} stale processing reports: {', '.join(requeued)}")
                else:
                    logger.info("WORKER: requeue sweep found no stale processing reports")
                    print("WORKER: requeue sweep found no stale processing reports")
                next_requeue_at = time.monotonic() + requeue_interval

            report = supabase.get_next_queued_report()
            if not report:
                logger.info("WORKER: queue idle - no queued reports")
                print("WORKER: queue idle - no queued reports")
                await asyncio.sleep(poll_seconds)
                continue

            report_id = report.get("id")
            if not report_id:
                logger.warning("WORKER: queue item missing id")
                await asyncio.sleep(poll_seconds)
                continue

            logger.info("WORKER: picked up queued report_id=%s", report_id)
            print(f"WORKER: picked up queued report_id={report_id}")
            locked = supabase.lock_report(report_id, worker_id, lock_seconds)
            if not locked:
                logger.info("WORKER: lock skipped for report_id=%s", report_id)
                continue

            logger.info("WORKER: locked report_id=%s", report_id)
            print(f"WORKER: locked report_id={report_id}")

            try:
                current_report_id = report_id
                supabase.update_report(report_id, "PROCESSING")
                start_time = time.monotonic()
                await agent.generate_report(
                    lat=report.get("lat"),
                    lng=report.get("lng"),
                    address=report.get("address"),
                    user_type=report.get("user_type", "buyer"),
                    flood_data=None,
                    report_id=report_id,
                )
                duration_s = time.monotonic() - start_time
                logger.info("WORKER: completed report_id=%s duration=%.2fs", report_id, duration_s)
                print(f"WORKER: completed report_id={report_id} duration={duration_s:.2f}s")
            except Exception as exc:
                logger.exception("WORKER: failed report_id=%s", report_id)
                supabase.update_report(report_id, "FAILED", error_message=str(exc))
            finally:
                current_report_id = None

        except Exception:
            logger.exception("WORKER: loop error")

        await asyncio.sleep(0)
