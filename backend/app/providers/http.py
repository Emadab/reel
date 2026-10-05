"""Shared HTTP layer for every non-movie provider (REEL_EXPANSION §5.4): one client per provider,
a request spacer just under the provider's limit, retries with backoff + jitter that honour Retry-After,
an SQLite response cache with ETag revalidation, and coalescing of identical in-flight requests.
When offline (app/net.py breaker) a stale cached response is served instead of failing."""
import asyncio
import hashlib
import json
import random
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException
from sqlmodel import Session, col, select

from .. import db, net
from ..config import settings
from ..models_media import HttpCache

DAY = 86_400
MAX_ATTEMPTS = 4


class ProviderUnavailable(HTTPException):
    def __init__(self, provider: str, detail: str):
        super().__init__(503, f"{provider}: {detail}")


def user_agent() -> str:
    contact = f"; {settings.contact_email}" if settings.contact_email else ""
    return f"Reel/0.1 (personal media tracker{contact})"


class Limiter:
    """Spaces requests at most `rate` per second (a token bucket with a burst of one)."""

    def __init__(self, rate: float) -> None:
        self.interval = 1 / rate
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            t = time.monotonic()
            delay = self._next - t
            self._next = max(t, self._next) + self.interval
        if delay > 0:
            await asyncio.sleep(delay)


class Client:
    def __init__(self, name: str, base_url: str, rate: float, ttl: int = DAY, headers: dict | None = None) -> None:
        self.name = name
        self.ttl = ttl
        self.limiter = Limiter(rate)
        self.http = httpx.AsyncClient(base_url=base_url, timeout=net.TIMEOUT, follow_redirects=True, headers=headers or {})
        self._inflight: dict[str, asyncio.Future] = {}

    def forget(self, path_prefix: str) -> None:
        """Drop cached responses under a path, so the next call refetches (e.g. a game's release date)."""
        prefix = str(self.http.base_url).rstrip("/") + path_prefix
        with Session(db.engine) as s:
            for row in s.exec(select(HttpCache).where(col(HttpCache.url).startswith(prefix))):
                s.delete(row)
            s.commit()

    async def get(self, path: str, params: dict | None = None, ttl: int | None = None, headers: dict | None = None) -> Any:
        return await self.request("GET", path, params=params, ttl=ttl, headers=headers)

    async def post(self, path: str, body: dict, ttl: int | None = None, headers: dict | None = None) -> Any:
        return await self.request("POST", path, body=body, ttl=ttl, headers=headers)

    async def request(self, method: str, path: str, params: dict | None = None, body: dict | None = None,
                      ttl: int | None = None, headers: dict | None = None) -> Any:
        """Parsed JSON, or None for a 404. Identical concurrent calls share one request."""
        params = {k: v for k, v in (params or {}).items() if v is not None}
        url = str(self.http.build_request(method, path, params=params).url)
        # secrets in params (API keys) never reach the cache key's readable url column
        shown = url.split("?")[0]
        key = hashlib.sha1(f"{method} {url} {json.dumps(body, sort_keys=True)}".encode()).hexdigest()
        if key in self._inflight:
            return await asyncio.shield(self._inflight[key])
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[key] = fut
        try:
            result = await self._fetch(method, path, params, body, key, shown, self.ttl if ttl is None else ttl, headers or {})
            fut.set_result(result)
            return result
        except BaseException as e:
            fut.set_exception(e)
            fut.exception()  # mark retrieved: nobody else may be waiting
            raise
        finally:
            del self._inflight[key]

    async def _fetch(self, method, path, params, body, key, shown, ttl, headers) -> Any:
        with Session(db.engine) as s:
            row = s.get(HttpCache, key)
            if row and _age(row) < row.ttl_s:
                return _parse(row)
            if net.offline():
                if row:
                    return _parse(row)
                raise ProviderUnavailable(self.name, "you're offline")
            hdrs = {"User-Agent": user_agent(), **headers}
            if row and row.etag:
                hdrs["If-None-Match"] = row.etag
            r = await self._send(method, path, params, body, hdrs, stale=row)
            if r is None:  # failed, but a stale copy exists
                return _parse(row)  # type: ignore[arg-type]
            if r.status_code == 304 and row:
                row.fetched_at = datetime.now(UTC)
                s.add(row)
                s.commit()
                return _parse(row)
            if r.status_code == 404:
                return None
            if r.status_code in (401, 403):
                raise ProviderUnavailable(self.name, "the key was rejected. Check it in Settings.")
            if r.status_code >= 400:
                raise ProviderUnavailable(self.name, f"HTTP {r.status_code}")
            row = row or HttpCache(key=key, url=shown, status=r.status_code, body=b"", ttl_s=ttl)
            row.status, row.etag, row.body, row.ttl_s = r.status_code, r.headers.get("etag"), r.content, ttl
            row.fetched_at = datetime.now(UTC)
            s.add(row)
            s.commit()
            return r.json()

    async def _send(self, method, path, params, body, headers, stale) -> httpx.Response | None:
        for attempt in range(MAX_ATTEMPTS):
            await self.limiter.wait()
            try:
                r = await self.http.request(method, path, params=params, json=body, headers=headers)
            except httpx.TransportError:
                if attempt >= 1:
                    net.mark_offline()
                    if stale:
                        return None
                    raise ProviderUnavailable(self.name, "you're offline")
                await asyncio.sleep(0.3)
                continue
            net.mark_online()
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == MAX_ATTEMPTS - 1:
                    break
                await asyncio.sleep(_retry_after(r) or (0.5 * 2**attempt + random.uniform(0, 0.25)))
                continue
            return r
        if stale:
            return None
        raise ProviderUnavailable(self.name, "rate limited or down. Try again shortly.")


def _retry_after(r: httpx.Response) -> float | None:
    try:
        return min(float(r.headers["retry-after"]), 30.0)
    except (KeyError, ValueError):
        return None


def _age(row: HttpCache) -> float:
    fetched = row.fetched_at if row.fetched_at.tzinfo else row.fetched_at.replace(tzinfo=UTC)
    return (datetime.now(UTC) - fetched).total_seconds()


def _parse(row: HttpCache) -> Any:
    return json.loads(row.body)
