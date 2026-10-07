"""Notifications: creation (deduplicated by key), and delivery to the desktop (a Windows toast through PowerShell,
so no extra dependency) and to a phone through an ntfy topic. Quiet hours hold delivery and send one digest after."""
import asyncio
import logging
import subprocess
import sys
from datetime import UTC, datetime, time, timedelta
from xml.sax.saxutils import escape

import httpx
from sqlmodel import Session, col, select

from . import net
from .db import get_setting
from .models_media import Notification

log = logging.getLogger("reel.notify")
DIGEST_AT = 3  # more pending than this: one summary instead of a burst


def now() -> datetime:
    return datetime.now(UTC)


def add(s: Session, key: str, type: str, title: str, text: str, path: str | None, item_id: int | None = None,
        episode_id: int | None = None, push: bool = True) -> Notification | None:
    """Create a notification once per dedupe key. Returns None if it already exists (jobs are idempotent)."""
    if s.exec(select(Notification).where(Notification.dedupe_key == key)).first():
        return None
    n = Notification(item_id=item_id, episode_id=episode_id, type=type, dedupe_key=key,
                     payload={"title": title, "text": text, "path": path, "push": push})
    s.add(n)
    s.flush()
    return n


def add_aired(s: Session, item_id: int, title: str, path: str, episode: dict, day: str, push: bool) -> None:
    """Same-day episodes of one show collapse into one notification."""
    key = f"aired:{item_id}:{day}"
    n = s.exec(select(Notification).where(Notification.dedupe_key == key)).first()
    code = f"S{episode['season']} · E{episode['number']}"
    if n is None:
        add(s, key, "episode_aired", title, f"{code} is out", path, item_id, episode["id"], push)
        n = s.exec(select(Notification).where(Notification.dedupe_key == key)).one()
        n.payload = {**n.payload, "episodes": [episode["id"]]}
    elif episode["id"] not in n.payload.get("episodes", []):
        eps = n.payload.get("episodes", []) + [episode["id"]]
        n.payload = {**n.payload, "episodes": eps, "text": f"{len(eps)} new episodes are out"}
    s.add(n)


# ---- delivery ----

def quiet_now(s: Session, at: datetime | None = None) -> bool:
    """Quiet hours like '23:00-08:00' (local time); empty means never quiet."""
    span = get_setting(s, "quiet_hours", "") or ""
    try:
        a, b = (time.fromisoformat(x.strip()) for x in span.split("-"))
    except ValueError:
        return False
    t = (at or datetime.now()).time()
    return a <= t < b if a < b else t >= a or t < b


def toast(title: str, text: str) -> None:
    """A Windows toast via PowerShell's WinRT bridge (registered app id, so it shows without installing anything)."""
    if sys.platform != "win32":
        return
    xml = f"<toast><visual><binding template='ToastGeneric'><text>{escape(title)}</text><text>{escape(text)}</text></binding></visual></toast>"
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;"
        "$x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml($env:REEL_TOAST);"
        "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))"
    )
    import os

    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], env={**os.environ, "REEL_TOAST": xml},
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=20, check=False, capture_output=True)


async def push(topic: str, title: str, text: str) -> bool:
    if net.offline("ntfy.sh"):
        return False
    try:
        async with httpx.AsyncClient(timeout=net.TIMEOUT) as c:
            r = await c.post(f"https://ntfy.sh/{topic}", content=text.encode(), headers={"Title": title})
        return r.status_code < 300
    except httpx.HTTPError:
        return False


async def deliver(s: Session) -> int:
    """Send what's pending (last 24 h) to the desktop and the ntfy topic. Held during quiet hours, then one digest."""
    if quiet_now(s):
        return 0
    desktop = (get_setting(s, "notify_desktop", "1") or "1") == "1"
    topic = (get_setting(s, "ntfy_topic", "") or "").strip()
    since = now() - timedelta(hours=24)
    pending = [n for n in s.exec(select(Notification).where(col(Notification.delivered_desktop_at).is_(None)).order_by(col(Notification.created_at)))
               if _utc(n.created_at) >= since]
    if not pending:
        return 0
    loud = [n for n in pending if n.payload.get("push", True)]
    if len(loud) > DIGEST_AT:
        title, text = f"Reel · {len(loud)} updates", "; ".join(n.payload["title"] for n in loud[:4]) + (" …" if len(loud) > 4 else "")
        messages = [(title, text)]
    else:
        messages = [(n.payload["title"], n.payload["text"]) for n in loud]
    for title, text in messages:
        if desktop:
            try:
                await asyncio.to_thread(toast, title, text)
            except Exception:  # a broken toast must not stop delivery
                log.warning("desktop toast failed", exc_info=True)
        if topic:
            await push(topic, title, text)
    stamp = now()
    for n in pending:
        n.delivered_desktop_at = stamp
        n.delivered_push_at = stamp if topic else None
        s.add(n)
    s.commit()
    return len(messages)


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
