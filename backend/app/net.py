"""A tiny circuit breaker: after a network failure, skip outbound calls for a while instead of
waiting on timeouts. Keeps the desktop app instant when the machine is offline."""
import time

import httpx

TIMEOUT = httpx.Timeout(15.0, connect=4.0)
COOLDOWN = 30.0
_offline_until = 0.0


def offline() -> bool:
    return time.monotonic() < _offline_until


def mark_offline() -> None:
    global _offline_until
    _offline_until = time.monotonic() + COOLDOWN


def mark_online() -> None:
    global _offline_until
    _offline_until = 0.0
