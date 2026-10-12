import uuid
from datetime import datetime, timedelta, timezone


def new_id() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


def start_of_today() -> datetime:
    n = now()
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


def days_ago(d: int) -> datetime:
    return now() - timedelta(days=d)


def pct(a: int, b: int) -> float:
    return round(a * 100.0 / b, 1) if b else 0.0
