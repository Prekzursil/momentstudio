from collections import Counter
from threading import Lock
from typing import Dict, Counter as CounterType

_metrics: CounterType[str] = Counter()
_lock = Lock()


def _inc(key: str) -> None:
    with _lock:
        _metrics[key] += 1


def record_signup() -> None:
    _inc("signups")


def record_login_success() -> None:
    _inc("logins")


def record_login_failure() -> None:
    _inc("login_failures")


def record_order_created() -> None:
    _inc("orders_created")


def record_payment_failure() -> None:
    _inc("payment_failures")


def snapshot() -> Dict[str, int]:
    with _lock:
        return dict(_metrics)


def reset() -> None:
    with _lock:
        _metrics.clear()
