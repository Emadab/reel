"""Wikidata: which TV series belong together (a franchise, a fictional universe, a spin-off or sequel), the
thing TMDB's movie collections give films. Free, no key; looked up by TMDB TV id (P4983)."""
from .http import DAY, Client

api = Client("Wikidata", "https://query.wikidata.org", rate=1, ttl=30 * DAY)

# franchise, part of the series, fictional universe: the group's name comes from the first of these it has
GROUPS = ("P8345", "P179", "P1434")
# follows, followed by, has spin-off: direct links in either direction
LINKS = ("P155", "P156", "P2512")

QUERY = """SELECT DISTINCT ?p ?groupLabel ?tmdb WHERE {
  ?show wdt:P4983 "%s" .
  { VALUES ?p { %s } ?show ?p ?group . ?other ?p ?group . }
  UNION { VALUES ?p { %s } { ?show ?p ?other } UNION { ?other ?p ?show } }
  ?other wdt:P4983 ?tmdb .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}"""


async def related_shows(tmdb_id: str) -> tuple[str | None, list[str]]:
    """(the group's name if it has one, TMDB TV ids of every show in it including this one)."""
    if not tmdb_id.isdigit():
        return None, []
    q = QUERY % (tmdb_id, " ".join(f"wdt:{p}" for p in GROUPS), " ".join(f"wdt:{p}" for p in LINKS))
    d = await api.get("/sparql", {"query": q, "format": "json"})
    rows = (d or {}).get("results", {}).get("bindings", [])
    rows = [r for r in rows if "tmdb" in r]
    ids = list(dict.fromkeys([tmdb_id] + [r["tmdb"]["value"] for r in rows]))
    named = sorted((GROUPS.index(p), r["groupLabel"]["value"]) for r in rows
                   if (p := r["p"]["value"].rsplit("/", 1)[-1]) in GROUPS and "groupLabel" in r)
    return (named[0][1] if named else None), ids
