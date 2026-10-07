"""Image download (data/media/...) and poster palette extraction (ARCHITECTURE §4)."""
import asyncio
import hashlib
import math
from pathlib import Path
from urllib.parse import urlparse

import httpx
from colorthief import ColorThief

from . import net
from .config import settings

IMG_HOST = "image.tmdb.org"
CDN = f"https://{IMG_HOST}/t/p"
img_client = httpx.AsyncClient(base_url=CDN, timeout=net.TIMEOUT, follow_redirects=True)
_sem = asyncio.Semaphore(8)

SIZES = {"poster": "w500", "poster_sm": "w185", "backdrop": "w1280", "profile": "w185"}


def media_file(kind: str, ident: int | str) -> Path:
    return settings.media_dir / kind / f"{ident}.jpg"


def media_url(kind: str, ident: int | str) -> str | None:
    return f"/media/{kind}/{ident}.jpg" if media_file(kind, ident).exists() else None


async def download(kind: str, ident: int | str, tmdb_path: str | None) -> Path | None:
    """Download once; later calls are a file-exists check."""
    if not tmdb_path:
        return None
    f = media_file(kind, ident)
    if f.exists():
        return f
    if net.offline(IMG_HOST):
        return None
    try:
        async with _sem:
            r = await img_client.get(f"/{SIZES[kind]}{tmdb_path}")
    except httpx.TransportError:
        net.mark_offline(IMG_HOST)
        raise
    r.raise_for_status()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(r.content)
    return f


async def cached_tmdb_image(size: str, name: str) -> Path:
    """Lazy cache for search thumbnails and cast photos, keyed by TMDB file name."""
    f = settings.media_dir / "tmdb" / size / name
    if not f.exists():
        if net.offline(IMG_HOST):
            raise FileNotFoundError(name)
        try:
            async with _sem:
                r = await img_client.get(f"/{size}/{name}")
        except httpx.TransportError:
            net.mark_offline(IMG_HOST)
            raise
        r.raise_for_status()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(r.content)
    return f


# ---- colour maths: sRGB <-> OKLCH ----

def _lin(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c: float) -> int:
    c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return round(min(1, max(0, c)) * 255)


def to_oklch(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r, g, b = (_lin(c) for c in rgb)
    l_ = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m_ = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s_ = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return L, math.hypot(a, bb), math.degrees(math.atan2(bb, a)) % 360


def from_oklch(L: float, C: float, H: float) -> str:
    a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return "#%02X%02X%02X" % (_gam(r), _gam(g), _gam(bl))


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def choose_palette(swatches: list[tuple[int, int, int]]) -> list[str]:
    """[glow, glow2, dark, light, ink] from colorthief swatches, per ARCHITECTURE §4."""
    lch = [to_oklch(c) for c in swatches]
    in_band = [c for c in lch if 0.55 <= c[0] <= 0.85]
    g = max(in_band or lch, key=lambda c: c[1])
    glow = (_clamp(g[0], 0.55, 0.85), g[1], g[2])

    def hue_gap(h1: float, h2: float) -> float:
        d = abs(h1 - h2) % 360
        return min(d, 360 - d)

    rest = sorted((c for c in lch if c is not g and hue_gap(c[2], g[2]) > 40 and c[1] > 0.02), key=lambda c: -c[1])
    glow2 = (_clamp(rest[0][0], 0.55, 0.85), rest[0][1], rest[0][2]) if rest else (0.6, max(g[1], 0.08), (g[2] + 150) % 360)
    darkest = min(lch, key=lambda c: c[0])
    lightest = max(lch, key=lambda c: c[0])
    return [
        from_oklch(*glow),
        from_oklch(*glow2),
        from_oklch(min(darkest[0], 0.25), darkest[1], darkest[2]),
        from_oklch(max(lightest[0], 0.85), min(lightest[1], 0.08), lightest[2]),
        from_oklch(0.12, min(darkest[1], 0.03), darkest[2]),
    ]


def extract_palette(poster: Path) -> tuple[list[str], str]:
    """Returns (palette, dominant colour hex)."""
    ct = ColorThief(str(poster))
    swatches = ct.get_palette(color_count=8, quality=5)
    dominant = "#%02X%02X%02X" % ct.get_color(quality=5)
    return choose_palette(swatches), dominant


def contrast(h1: str, h2: str) -> float:
    def lum(h: str) -> float:
        r, g, b = (_lin(c) for c in hex_to_rgb(h))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    a, b = sorted((lum(h1), lum(h2)), reverse=True)
    return (a + 0.05) / (b + 0.05)


def hash_colour(ident: int) -> str:
    return from_oklch(0.45, 0.09, (ident * 137.508) % 360)


def poster_art(tmdb_id: int, palette: list[str], dominant: str | None) -> dict:
    """Colours and motif for the generative PosterArt fallback."""
    bg = dominant or (palette[2] if palette else hash_colour(tmdb_id))
    candidates = [palette[3], palette[2]] if palette else ["#F1E6C8", "#0A0E12"]
    fg = max(candidates + ["#F4EDE2", "#120904"], key=lambda c: contrast(bg, c))
    return {"bg": bg, "fg": fg, "motif": ("sun", "band", "arch")[tmdb_id % 3]}


def on_glow_text(glow: str) -> str:
    return "#120904" if contrast(glow, "#120904") >= 4.5 else "#FFFFFF"


# ---- images for shows, books and games: data/media/<kind>/<sha1 of url>.<ext> ----
any_client = httpx.AsyncClient(timeout=net.TIMEOUT, follow_redirects=True, headers={"User-Agent": "Reel/0.1 (personal media tracker)"})


async def store_image(kind: str, url: str | None) -> str | None:
    """Download once and return the /media/... URL; None when there is no image or we're offline."""
    if not url:
        return None
    ext = Path(url.split("?")[0]).suffix.lower()
    ext = ext if ext in (".jpg", ".jpeg", ".png", ".webp") else ".jpg"
    name = f"{hashlib.sha1(url.encode()).hexdigest()[:20]}{ext}"
    f = settings.media_dir / kind / name
    if not f.exists():
        host = urlparse(url).hostname or ""
        if net.offline(host):
            return None
        try:
            async with _sem:
                r = await any_client.get(url)
        except httpx.TransportError:
            net.mark_offline(host)
            return None
        if r.status_code != 200 or not r.headers.get("content-type", "image").startswith("image"):
            return None
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(r.content)
    return f"/media/{kind}/{name}"


def palette_for(media_url: str | None) -> tuple[list[str], str | None]:
    """Palette from a stored image, reusing the poster method; ([], None) if it can't be read."""
    if not media_url:
        return [], None
    try:
        return extract_palette(settings.media_dir / media_url.removeprefix("/media/"))
    except Exception:  # a corrupt or tiny image must not break an add
        return [], None
