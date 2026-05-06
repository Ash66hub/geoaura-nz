import asyncio
import logging
import os

from services.agent_service import AgentService
from services.supabase_service import SupabaseService

logger = logging.getLogger(__name__)


def _get_poll_seconds() -> int:
    raw = os.getenv("REPORT_WORKER_POLL_SECONDS", "3")
    try:
        return max(1, int(raw))
    except ValueError:
        return 3


def _get_worker_enabled() -> bool:
    return os.getenv("RUN_REPORT_WORKER") == "1"


def _get_requeue_after_seconds() -> int:
    raw = os.getenv("REPORT_REQUEUE_AFTER_SECONDS", "900")
    try:
        return max(60, int(raw))
    except ValueError:
        return 900


async def report_worker_loop() -> None:
    if not _get_worker_enabled():
        logger.info("Report worker is disabled (RUN_REPORT_WORKER != 1).")
        return

    supabase = SupabaseService()
    agent = AgentService()
    poll_seconds = _get_poll_seconds()
    requeue_after = _get_requeue_after_seconds()

    requeued = supabase.requeue_stale_processing_reports(requeue_after)
    if requeued:
        logger.info("Requeued %s stale processing reports", requeued)

    logger.info("Report worker started. Poll interval=%ss", poll_seconds)

    while True:
        try:
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
