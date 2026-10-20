"""Build data/lavatubes.json: documented lava-tube caves with exact coordinates.

Sources (both Wikidata, CC0):
  1. items that are instances of "lava tube" (Q27919) or its subclasses;
  2. caves (Q35509) whose English description calls them a lava tube, lava cave or
     volcanic cave.
Plus tools/lavatubes_extra.json: well-documented systems that Wikidata does not yet
hold with coordinates (each with a citation).

Usage: python3 tools/build_lavatubes.py
"""
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = 'AnalogScope-build/1.0 (https://github.com/samuelakosaonyejekwe/analogscope)'
QUERIES = [
    'SELECT ?item ?itemLabel ?coord WHERE { ?item wdt:P31/wdt:P279* wd:Q27919; wdt:P625 ?coord. '
    'SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es,pt,fr,de,it,ja,ko,is,vi". } }',
    'SELECT DISTINCT ?item ?itemLabel ?coord WHERE { ?item wdt:P31/wdt:P279* wd:Q35509; wdt:P625 ?coord; '
    'schema:description ?d. FILTER(LANG(?d)="en" && (CONTAINS(LCASE(?d),"lava tube") || CONTAINS(LCASE(?d),"lava-tube") '
    '|| CONTAINS(LCASE(?d),"lava cave") || CONTAINS(LCASE(?d),"volcanic cave"))) '
    'SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es,pt,fr,de,it,ja,ko,is,vi". } }',
]


def sparql(q):
    url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': q})
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)['results']['bindings']


def km(a, b):
    r = math.radians
    x = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


tubes = {}
for q in QUERIES:
    for row in sparql(q):
        qid = row['item']['value'].rsplit('/', 1)[-1]
        if qid in tubes:
            continue                                  # first coordinate wins for multi-point items
        lon, lat = map(float, row['coord']['value'][6:-1].split())
        name = row['itemLabel']['value']
        if name == qid:
            continue                                  # no label in any listed language
        tubes[qid] = [round(lat, 4), round(lon, 4), name, qid]

extra = json.loads((ROOT / 'tools' / 'lavatubes_extra.json').read_text())
for e in extra:
    if all(km((e['lat'], e['lon']), (t[0], t[1])) > 3 for t in tubes.values()):
        tubes[e['id']] = [e['lat'], e['lon'], e['name'], e['source']]

out = sorted(tubes.values(), key=lambda t: (t[0], t[1]))
(ROOT / 'data' / 'lavatubes.json').write_text(json.dumps({
    'source': 'Wikidata (CC0): lava tubes (Q27919) and caves described as lava/volcanic caves; plus tools/lavatubes_extra.json',
    'fields': ['lat', 'lon', 'name', 'ref'],
    'v': out,
}, ensure_ascii=False, separators=(',', ':')))
print(len(out), 'lava tubes written to data/lavatubes.json')
