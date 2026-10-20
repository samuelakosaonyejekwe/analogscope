# AnalogScope

**Earth analogs for Moon and Mars bases**, built for the 2026 NASA Space Apps Challenge:
*Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars*.

**Live app:** https://samuelakosaonyejekwe.github.io/analogscope/

AnalogScope scores any place on Earth from 0 to 100 for how well it stands in for eight
Moon and Mars environments: the Artemis lunar south pole, lunar mare plains, lunar lava
tubes, Jezero Crater, Gale Crater and Meridiani, Arcadia Planitia, the Tharsis highlands and
Martian caves. It explains every score, scans whole regions to find new analog sites
that have not been studied yet, and works offline once installed.

## Features

- **Explore map**: 35 documented analog sites (Haughton Crater, Atacama, Dry Valleys,
  Mauna Kea, Lanzarote, Río Tinto and others), colour-coded by score. Tap anywhere on Earth to score that spot.
- **Site report**: Analog Fidelity Score, factor-by-factor fit and radar chart, geology match,
  best months for a field campaign, a score from the last 30 days of weather, nearby natural hazards,
  and NASA archive photos. Reports can be shared, printed or downloaded as JSON.
- **Discover**: scores every grid cell in a 10° × 10° area with NASA, JAXA and ESA data, and labels
  promising cells far from any known site as **NEW** candidates. You can save candidates on your device.
- **Mission profiles**: rover and mobility, ice and resources, astrobiology, habitat and crew. Each re-weights the factors.
- **Rankings**: a matrix of every site against every target, plus a CSV export.
- **Twin view**: an Earth site (ESA Sentinel-2) next to its Moon or Mars counterpart (NASA Trek),
  with live Curiosity weather on Mars beside today's conditions at the Earth site.
- **Live feeds**: Mars weather (Curiosity REMS), space weather (NOAA Kp and GOES X-ray),
  NASA EONET natural events, USGS earthquakes and the NASA picture of the day.
- **Installable and offline**: a PWA for Android, iPhone and iPad, Windows, macOS, Linux and ChromeOS.
  It works in airplane mode, and an offline map pack can be saved before travelling.

## Live data with no backend

AnalogScope is a static site. **Each visitor's browser fetches data directly** from the agencies'
public APIs, so it keeps running when the developer's machine is off, has no servers to maintain,
and needs no API keys.

| Source | Agency | Used for |
|---|---|---|
| POWER (MERRA-2, CERES, IMERG) | NASA | Climate normals and daily values |
| JAXA Earth API (GCOM-C, GCOM-W, MODIS) | JAXA | NDVI, land surface temperature, soil moisture |
| CCI / C3S land cover (via JAXA) | ESA / Copernicus | Bare-ground fraction |
| Sentinel-2 cloudless (EOX) | ESA / Copernicus | Earth imagery |
| GIBS | NASA | Blue Marble, yesterday's VIIRS/MODIS, LST, ASTER relief |
| Terrain tiles (SRTM) | NASA / NGA | Elevation, relief, slope |
| Moon Trek / Mars Trek | NASA | LRO and Viking mosaics |
| Curiosity REMS weather | NASA JPL / CAB | Live Mars weather |
| EONET, APOD, Image Library | NASA | Events, imagery |
| SWPC | NOAA | Space weather |
| Earthquake feed | USGS | Seismic hazards |

## Scoring method

```
fit  = smoothstep(clamp((x − worst) / (best − worst), 0, 1))
EAI  = Σ wᵢ·mᵢ·fitᵢ / Σ wᵢ·mᵢ            environmental analog index
GCS  = matched geology weight / target geology weight
AFS  = (1 − g)·EAI + g·GCS                g = 0.35 (0.6 for cave targets)
```

The Method tab in the app documents every factor, weight, source and limitation.

## Run locally

Nothing needs to be built. Serve the folder with any static server:

```
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Project layout

```
index.html, styles.css, sw.js, manifest.webmanifest
js/      app, state, data (API layer), engine (scoring), scan (discovery),
         targets, sites, mapview, report, pages, charts, install
data/    snapshot.json – bundled normals for the documented sites (offline first run)
vendor/  Leaflet 1.9.4
icons/   app icons
```

## Privacy and security

There are no accounts, cookies, analytics or trackers. A strict Content-Security-Policy restricts
connections to the data providers listed above. Settings and saved candidates stay in the
browser's local storage.

## License

MIT. Data and imagery remain the property of their providers and are used under their open-data terms.
