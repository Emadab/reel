"""A tiny circuit breaker, per host: after a network failure, skip calls to that host for a while instead of
waiting on timeouts. Per host because a filtered network blocks some providers while others still work.
Keeps the desktop app instant when the machine is offline. No host means every host."""
import time

import httpx

TIMEOUT = httpx.Timeout(15.0, connect=2.5)  # connect covers TCP + TLS: ~0.5 s even through a VPN
COOLDOWN = 30.0
_down: dict[str, float] = {}  # host -> monotonic time it may be tried again; "" = everything


def offline(host: str = "") -> bool:
    t = time.monotonic()
    return t < _down.get("", 0.0) or t < _down.get(host, 0.0)


def mark_offline(host: str = "") -> None:
    _down[host] = time.monotonic() + COOLDOWN


def mark_online(host: str = "") -> None:
    if host:
        _down.pop(host, None)
        _down.pop("", None)  # a host answered, so the machine is online
    else:
        _down.clear()


def connect_failed(e: httpx.TransportError) -> bool:
    """The host couldn't be reached at all (offline, blocked, DNS): retrying only doubles the wait."""
    return isinstance(e, (httpx.ConnectError, httpx.ConnectTimeout))
