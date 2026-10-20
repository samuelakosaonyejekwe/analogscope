# AnalogScope

**Earth analogs for Moon and Mars bases**, built for the 2026 NASA Space Apps Challenge:
*Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*.

**Live app:** https://samuelakosaonyejekwe.github.io/analogscope/

AnalogScope scores any place on Earth from 0 to 100 for how well it stands in for eight
Moon and Mars environments: the Artemis lunar south pole, lunar mare plains, lunar lava
tubes, Jezero Crater, Gale Crater and Meridiani, Arcadia Planitia, the Tharsis highlands and
Martian caves. It explains every score, scans whole regions for analog sites that have not
been studied yet, and works offline once installed.

## Features

- **Explore map**: 35 documented analog sites (Haughton Crater, Atacama, Dry Valleys,
  Mauna Kea, Lanzarote, Río Tinto and others), colour-coded by score. Tap anywhere on Earth
  to score that spot. Optional layers: live NASA EONET events, Smithsonian volcanoes and
  documented lava-tube caves.
- **Site report**: Analog Fidelity Score, factor-by-factor fit and radar chart, geology and
  cave evidence, *what no Earth site can reproduce* (with the lab facilities that cover it),
  best months for a field campaign, a score from the last 30 days of weather, nearby natural
  hazards and NASA archive photos. Reports can be shared, printed or downloaded as JSON.
- **Discover**: scores every grid cell in a 10° × 10° area with NASA, JAXA and ESA data, and
  labels high-scoring cells more than 150 km from any documented site as **NEW** candidates.
  Candidates can be saved on the device.
- **Mission profiles**: rover and mobility, ice and resources, astrobiology, habitat and crew.
  Each one re-weights the factors.
- **Rankings**: a matrix of every site against every target, plus a CSV export.
- **Twin view**: an Earth site (ESA Sentinel-2) next to its Moon or Mars counterpart
  (NASA Trek), with today's conditions at the site next to Mars.
- **Live**: Mars now (season and local solar time computed with NASA's Mars24 algorithm,
  seasonal normals from Curiosity's REMS archive, the latest rover report), NOAA space
  weather, NASA EONET events, USGS earthquakes, and the NASA picture of the day (APOD, with
  NASA Image of the Day as a fallback).
- **Navigation**: clean URLs (`#/rankings`, `#/twin`, `#/live`, `#/method`), back and forward
  arrows, previous/next page cards, and shareable links to any site or point.
- **Install centre**: the always-visible **Install app** button opens one-tap install where the
  browser offers it, step-by-step guidance for Android, iPhone/iPad, Windows, Mac, Linux and
  Chromebook, a QR code to open the app on a phone, and an offline-readiness check.
- **Update pop-up**: new versions are detected at launch, every 30 minutes and when the app returns
  to the foreground. A pop-up shows what's new and updates in one tap. The version number and a
  *Check for updates* button are on the Method page.
- **Installable and offline**: a PWA for Android, iPhone and iPad, Windows, macOS, Linux and
  ChromeOS. Firefox installs it on Windows (143+, “Add tab to taskbar”) and on Linux once
  `browser.taskbarTabs.enabled` is on; Firefox on macOS gets a one-click desktop shortcut.
  The app works in airplane mode, and an offline map pack (about 12 MB) can be saved before
  travelling.

## Live data with no backend

AnalogScope is a static site. **Each visitor's browser fetches data directly** from the agencies'
public APIs, so it keeps running when the developer's machine is off, has no servers to maintain,
and needs no API keys.

| Source | Agency | Used for |
|---|---|---|
| POWER (MERRA-2, CERES) | NASA | Climate normals (2001–2020) and daily values |
| JAXA Earth API (MODIS NDVI, GCOM-C SGLI, GCOM-W AMSR2) | JAXA | Vegetation, ground temperature, soil moisture |
| CCI / C3S land cover 2019 (via JAXA) | ESA / Copernicus | Bare-ground score |
| Sentinel-2 cloudless 2021 (EOX) | ESA / Copernicus | Earth imagery |
| GIBS | NASA | Blue Marble, yesterday's VIIRS/MODIS, land surface temperature, ASTER relief |
| Terrain tiles (SRTM and other DEMs) | NASA / NGA / NOAA | Elevation, relief, slope |
| Moon Trek / Mars Trek | NASA | LRO and Viking mosaics |
| Curiosity REMS weather | NASA JPL / CAB | Mars weather and seasonal normals |
| Mars24 algorithm | NASA GISS | Mars season and local time (computed on the device) |
| Volcanoes of the World | Smithsonian GVP | Cave evidence (bundled) |
| Wikidata lava tubes | Wikimedia (CC0) | 60 documented lava-tube caves (bundled) |
| EONET, APOD, Image of the Day, Image Library | NASA | Events and imagery |
| SWPC | NOAA | Space weather |
| Earthquake feed | USGS | Seismic hazards |

## Scoring method

```
fit  = smoothstep(clamp((x − worst) / (best − worst), 0, 1))
EAI  = Σ wᵢ·mᵢ·fitᵢ / Σ wᵢ·mᵢ            environmental analog index (m = mission multiplier)
GCS  = matched geology weight / target geology weight
AFS  = (1 − g)·EAI + g·GCS                g = 0.35 (0.6 for cave targets)
```

JAXA layers are monthly normals; annual values are the mean of January, April, July and
October, to match POWER's annual normals. Cave targets cannot be judged from climate alone.
They use cave evidence: documented lava tubes (Wikidata) count in full, and basaltic lava-flow
volcanoes (Smithsonian) get half credit. Without evidence, the score is capped. The in-app **Method** page documents
every factor, weight, source and limitation.

## Run locally

Nothing needs to be built. Serve the folder with any static server and open it:

```
python3 -m http.server 8080      # then visit http://localhost:8080
```

## Rebuilding the bundled data

| File | Built by | Source |
|---|---|---|
| `data/snapshot.json` | `tools/build_snapshot.mjs` | The app's own data layer, run in a headless browser |
| `data/volcanoes.json` | `tools/build_volcanoes.py` | Smithsonian GVP WFS exports (Holocene and Pleistocene) |
| `data/lavatubes.json` | `tools/build_lavatubes.py` | Wikidata SPARQL queries plus `tools/lavatubes_extra.json` (each with a Wikidata ID) |

```
cd tools && npm install && npx playwright install chromium && npm run snapshot
python3 tools/build_volcanoes.py holocene.json pleistocene.json data/volcanoes.json
python3 tools/build_lavatubes.py
```

## Project layout

```
index.html, styles.css, sw.js, manifest.webmanifest
js/      app (routing), state, data (API layer), engine (scoring), scan (discovery),
         evidence (caves), mars (Mars24 + REMS), targets, sites,
         mapview, report, pages, charts, install
data/    snapshot.json, volcanoes.json, lavatubes.json
tools/   build_snapshot.mjs, build_volcanoes.py, build_lavatubes.py
vendor/  Leaflet 1.9.4
icons/   app icons and store screenshots
```

## Privacy and security

There are no accounts, cookies, analytics or trackers. A strict Content-Security-Policy
restricts connections to the data providers listed above, and links taken from external
feeds are limited to http(s). Settings and saved candidates stay in the browser's local storage.

## License

MIT. Data and imagery remain the property of their providers and are used under their
open-data terms.
