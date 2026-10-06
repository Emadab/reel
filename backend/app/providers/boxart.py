"""Box art for games: RAWG only has screenshots and key art, so covers come from the game's English Wikipedia
article (its infobox image is the box art), then Steam's 600x900 library cover, then RAWG's image. No keys."""
import re

from .http import DAY, Client, ProviderUnavailable

wiki = Client("Wikipedia", "https://en.wikipedia.org/w", rate=1, ttl=30 * DAY)
# words an edition adds to a game's name; anything else (Remake, 2, Legends) makes it a different game
EDITION = {"complete", "edition", "remastered", "definitive", "goty", "game", "of", "the", "year", "ultimate", "deluxe",
           "enhanced", "directors", "director", "s", "cut", "final", "hd", "royal", "legendary", "collection", "anniversary"}
STEAM = "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_600x900.jpg"


def words(s: str) -> list[str]:
    return re.sub(r"[^a-z0-9 ]", " ", s.lower().replace("&", " and ")).split()


def best_article(title: str, year: int | None, pages: list[dict]) -> dict | None:
    """The article about this game among search results: the same title (ignoring punctuation and a '(video game)'
    suffix), else the longest article title that is the game's minus edition words ('Complete Edition', 'Royal'). Ties go to '(… video game)' articles, then one with the game's year in it; series and
    franchise articles never count."""
    mine = set(words(title))
    found = []
    for p in pages:
        base, _, paren = p["title"].partition(" (")
        theirs = words(base)
        exact = theirs == words(title)
        if "series" in paren or "franchise" in paren:
            continue  # a series article's image is its logo
        if exact or (len(theirs) > 1 and set(theirs) <= mine and mine - set(theirs) <= EDITION):
            found.append(((exact, len(theirs), "game" in paren, bool(year and str(year) in paren), -p.get("index", 0)), p))
    return max(found, key=lambda f: f[0])[1] if found else None


async def wikipedia(title: str, year: int | None) -> str | None:
    d = await wiki.get("/api.php", {"action": "query", "format": "json", "generator": "search", "gsrlimit": 8,
                                    "gsrsearch": f"{title} video game", "prop": "pageprops", "ppprop": "page_image"})
    pages = [p for p in ((d or {}).get("query") or {}).get("pages", {}).values() if (p.get("pageprops") or {}).get("page_image")]
    page = best_article(title, year, pages)
    if not page:
        return None
    f = await wiki.get("/api.php", {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url",
                                    "iiurlwidth": 600, "titles": f"File:{page['pageprops']['page_image']}"})
    info = (next(iter(((f or {}).get("query") or {}).get("pages", {}).values()), {}).get("imageinfo") or [{}])[0]
    return info.get("thumburl") or info.get("url")


async def covers(title: str, year: int | None, steam_id: str | None) -> list[str]:
    """Box-art URLs to try, best first."""
    out = []
    try:
        if url := await wikipedia(title, year):
            out.append(url)
    except ProviderUnavailable:
        pass  # offline or throttled: Steam or RAWG's image for now, the box art on a later refresh
    if steam_id:
        out.append(STEAM.format(steam_id))
    return out
