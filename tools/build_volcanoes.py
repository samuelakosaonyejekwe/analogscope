"""Build data/volcanoes.json from the Smithsonian Global Volcanism Program (VOTW 5.x).

Usage: python3 tools/build_volcanoes.py holocene.json pleistocene.json data/volcanoes.json
The two inputs are the GVP GeoServer WFS GeoJSON exports
(GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes / ..._Pleistocene_Volcanoes).
"""
import json
import sys

# Volcano forms built mainly by fluid lava flows, where lava tubes develop.
EFFUSIVE = ('shield', 'volcanic field', 'fissure vent', 'crater rows', 'lava cone', 'pyroclastic cone')
BASALTIC = ('basalt', 'picro', 'tephrite', 'basanite', 'foidite')


def rows(path, epoch):
    for f in json.load(open(path))['features']:
        p = f['properties']
        vtype = (p.get('Primary_Volcano_Type') or '').strip()
        rock = (p.get('Major_Rock_Type') or '').lower()
        basaltic = None if not rock or 'no data' in rock else int(any(b in rock for b in BASALTIC) and 'andesite' not in rock)
        yield [round(p['Latitude'], 3), round(p['Longitude'], 3), p['Volcano_Name'], vtype,
               int(any(e in vtype.lower() for e in EFFUSIVE)), basaltic, epoch, p.get('Last_Eruption_Year')]


hol, ple, out = sys.argv[1:4]
data = list(rows(hol, 'H')) + list(rows(ple, 'P'))
json.dump({'source': 'Smithsonian Institution Global Volcanism Program, Volcanoes of the World (VOTW)',
           'fields': ['lat', 'lon', 'name', 'type', 'effusive', 'basaltic', 'epoch', 'lastEruption'],
           'v': data}, open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(data), 'volcanoes')
