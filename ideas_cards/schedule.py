"""When the one Ideas thread should wake. Weekday price screens, Sunday trends."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ideas_cards.catalog import STAGES_SUNDAY, STAGES_WEEKDAY

LA = ZoneInfo("America/Los_Angeles")
MAX_ATTEMPTS = 3


def stages_for(day) -> tuple[str, ...]:
    wd = day.weekday()
    if wd == 5:
        return ()
    if wd == 6:
        return STAGES_SUNDAY
    return STAGES_WEEKDAY


def _clock(day, hhmm: str) -> datetime:
    hour, minute = (hhmm or "06:00").split(":", 1)
    return datetime(day.year, day.month, day.day, int(hour), int(minute), tzinfo=LA)


def next_session(day, start: str) -> datetime:
    probe = day + timedelta(days=1)
    for _ in range(8):
        if stages_for(probe):
            return _clock(probe, start)
        probe += timedelta(days=1)
    return _clock(probe, start)


def _secs(target: datetime, now: datetime) -> float:
    return max(0.0, (target - now).total_seconds())


def plan_tick(now: datetime, stage_rows: dict | None = None, *, auto: bool = True,
              start: str = "06:00") -> dict:
    """Return run or sleep. A succeeded stage is not run again that day."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=LA)
    local = now.astimezone(LA)
    rows = stage_rows or {}
    start_at = _clock(local.date(), start)
    due = stages_for(local.date())

    def sleep(until: datetime, reason: str) -> dict:
        return {
            "action": "sleep",
            "sleep_sec": _secs(until, local),
            "reason": reason,
            "stage": None,
        }

    if not auto:
        until = start_at if local < start_at else next_session(local.date(), start)
        return sleep(until, "manual")
    if not due:
        return sleep(next_session(local.date(), start), "weekend")
    if local < start_at:
        return sleep(start_at, "before_start")
    for stage in due:
        row = rows.get(stage) or {}
        if (row.get("status") or "") == "succeeded":
            continue
        if int(row.get("attempts") or 0) >= MAX_ATTEMPTS:
            continue
        return {"action": "run", "sleep_sec": 0, "reason": "due", "stage": stage}
    return sleep(next_session(local.date(), start), "done")


def stage_open(rows: dict | None, stage: str) -> bool:
    """A succeeded stage, or one that already used its attempts, stays idle."""
    row = (rows or {}).get(stage) or {}
    if (row.get("status") or "") == "succeeded":
        return False
    if int(row.get("attempts") or 0) >= MAX_ATTEMPTS:
        return False
    return True


def capped_sleep(seconds, cap: float = 900.0) -> float:
    """Re-plan at least every 15 minutes, the same bound the podcast thread uses."""
    try:
        value = float(seconds or 0)
    except (TypeError, ValueError):
        value = 0.0
    if value < 0:
        value = 0.0
    return min(value, float(cap))
