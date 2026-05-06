import asyncio
import logging
import os
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


async def report_worker_loop() -> None:
    logging.getLogger().setLevel(logging.INFO)
    logger.setLevel(logging.INFO)

    if not _get_worker_enabled():
        logger.info("Report worker is disabled (RUN_REPORT_WORKER != 1).")
        return

    supabase = SupabaseService()
    agent = AgentService()
    poll_seconds = _get_poll_seconds()
    requeue_after = _get_requeue_after_seconds()
    requeue_interval = _get_requeue_interval_seconds()
    next_requeue_at = time.monotonic() + requeue_interval

    requeued = supabase.requeue_stale_processing_reports(requeue_after)
    if requeued:
        logger.info("Requeued %s stale processing reports: %s", len(requeued), ", ".join(requeued))

    logger.info("Report worker started. Poll interval=%ss", poll_seconds)
    print(f"Report worker started. Poll interval={poll_seconds}s")

    while True:
        try:
            logger.info("Report worker poll")
            print("Report worker poll")

            if time.monotonic() >= next_requeue_at:
                requeued = supabase.requeue_stale_processing_reports(requeue_after)
                if requeued:
                    logger.info("Requeued %s stale processing reports: %s", len(requeued), ", ".join(requeued))
                next_requeue_at = time.monotonic() + requeue_interval

            report = supabase.get_next_queued_report()
            if not report:
                await asyncio.sleep(poll_seconds)
                continue

            report_id = report.get("id")
            if not report_id:
                await asyncio.sleep(poll_seconds)
                continue

            claimed = supabase.claim_report(report_id)
            if not claimed:
                continue

            try:
                await agent.generate_report(
                    lat=report.get("lat"),
                    lng=report.get("lng"),
                    address=report.get("address"),
                    user_type=report.get("user_type", "buyer"),
                    flood_data=None,
                    report_id=report_id,
                )
            except Exception as exc:
                logger.exception("Report worker failed for report_id=%s", report_id)
                supabase.update_report(report_id, "FAILED", error_message=str(exc))

        except Exception:
            logger.exception("Report worker loop error")

        await asyncio.sleep(0)
