// Planetary target environments and the criteria used to score Earth analogs.
//
// Each criterion maps an Earth-observable variable onto a 0..1 score:
//   best  -> score 1 (the most Moon/Mars-like value reachable on Earth)
//   worst -> score 0
// Values between are eased with smoothstep. Planetary reference values are
// shown for context only; no place on Earth reaches them.

// Planetary reference values used in comparisons (one source for every quoted number).
export const PLANET = {
  mars: { pressureKPa: 0.6, meanTempC: -60, gravityG: 0.38 },   // global means (NASA Mars Fact Sheet)
  moon: { surfaceSwingC: 300, gravityG: 0.165 },                 // −173 °C to +127 °C at the equator (LRO Diviner)
};

export const VARIABLES = {
  T2M:        { short: 'Cold', label: 'Mean air temperature', unit: '°C', src: 'NASA POWER (MERRA-2)', dp: 1 },
  T2M_RANGE:  { short: 'Air swing', label: 'Day–night temperature swing', unit: '°C', src: 'NASA POWER (MERRA-2)', dp: 1 },
  PRECIP:     { short: 'Dry', label: 'Precipitation', unit: 'mm/yr', src: 'NASA POWER (MERRA-2, bias-corrected)', dp: 0 },
  RH2M:       { short: 'Humidity', label: 'Relative humidity', unit: '%', src: 'NASA POWER (MERRA-2)', dp: 0 },
  UV:         { short: 'UV', label: 'UV index (24-h mean)', unit: '', src: 'NASA POWER (CERES)', dp: 1 },
  SOLAR:      { short: 'Sun', label: 'Solar energy at surface', unit: 'kWh/m²/day', src: 'NASA POWER (CERES)', dp: 2 },
  PS:         { short: 'Thin air', label: 'Surface air pressure', unit: 'kPa', src: 'NASA POWER (MERRA-2)', dp: 1 },
  CLOUD:      { short: 'Clear sky', label: 'Cloud cover', unit: '%', src: 'NASA POWER (CERES)', dp: 0 },
  WIND:       { short: 'Wind', label: 'Wind speed at 2 m', unit: 'm/s', src: 'NASA POWER (MERRA-2)', dp: 1 },
  ELEV:       { short: 'Elevation', label: 'Elevation', unit: 'm', src: 'Terrain tiles (SRTM 60°N–56°S; coarser DEMs elsewhere)', dp: 0 },
  RELIEF:     { short: 'Relief', label: 'Local relief (≈3 km window)', unit: 'm', src: 'Terrain tiles (SRTM 60°N–56°S; coarser DEMs elsewhere)', dp: 0 },
  SLOPE:      { short: 'Flatness', label: 'Surface slope', unit: '°', src: 'Terrain tiles (SRTM 60°N–56°S; coarser DEMs elsewhere)', dp: 1 },
  ABSLAT:     { short: 'Polar', label: 'Latitude (sun-angle proxy)', unit: '°', src: 'Geometry', dp: 1 },
  NDVI:       { short: 'No plants', label: 'Vegetation index (NDVI)', unit: '', src: 'JAXA JASMES (Terra/Aqua MODIS, 2012–2021), 4-season mean', dp: 2 },
  LST_SWING:  { short: 'Ground swing', label: 'Ground day–night swing', unit: '°C', src: 'JAXA JASMES land surface temp. (GCOM-C SGLI), 4-season mean', dp: 1 },
  LST_NIGHT:  { short: 'Cold nights', label: 'Ground temperature at night', unit: '°C', src: 'JAXA JASMES land surface temp. (GCOM-C SGLI), 4-season mean', dp: 1 },
  SOILM:      { short: 'Dry soil', label: 'Soil moisture', unit: '%', src: 'JAXA GCOM-W AMSR2 (2012–2021), 4-season mean', dp: 1 },
  BARREN:     { short: 'Bare', label: 'Bare-ground score (land cover)', unit: '', src: 'ESA CCI / Copernicus C3S land cover 2019', dp: 2 },
};

export const GEOLOGY = {
  basalt:      'Basaltic volcanic rock',
  tephra:      'Fine volcanic ash / regolith-like soil',
  impact:      'Impact crater structure',
  lavatube:    'Lava tubes, pits or caves',
  lavaprone:   'Lava-tube-forming volcanic setting (inferred)',
  permafrost:  'Permafrost / ground ice',
  polar:       'Polar light regime',
  evaporite:   'Salts, sulfates & evaporites',
  clay:        'Clays & phyllosilicates',
  sediment:    'Layered sediments / ancient lake or delta',
  acidic:      'Acidic, iron-rich waters (jarosite)',
  hydrothermal:'Hydrothermal activity',
  aeolian:     'Wind-blown dunes & dust',
  sterile:     'Near-sterile, oxidising soil',
  biosig:      'Ancient biosignatures / stromatolites',
  highalt:     'High altitude, thin air',
};

export const TARGETS = [
  {
    id: 'moon-south-pole', body: 'moon', name: 'Lunar South Pole',
    short: 'Artemis base region', lat: -89.67, lon: 129.78,
    blurb: 'Rim of Shackleton crater and nearby ridges, the region Artemis is targeting for crewed landings. The Sun stays near the horizon, crater floors never see sunlight and hold water ice, and the ground is rough and covered in impact debris.',
    ref: { 'Surface temperature': 'As low as −248 °C (≈ 25 K) in permanently shadowed craters; ≈ −50 °C on sunlit rims', Atmosphere: 'None (exosphere)', 'Sun elevation': '< 2° above horizon', Resource: 'Water ice in permanently shadowed regions' },
    criteria: [
      { v: 'T2M', best: -35, worst: 15, w: 3 },
      { v: 'ABSLAT', best: 78, worst: 50, w: 3 },
      { v: 'PRECIP', best: 50, worst: 700, w: 2 },
      { v: 'RELIEF', best: 500, worst: 20, w: 2 },
      { v: 'CLOUD', best: 30, worst: 85, w: 1 },
      { v: 'LST_NIGHT', best: -35, worst: 5, w: 1 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 2 },
      { v: 'NDVI', best: 0.03, worst: 0.4, w: 1 },
    ],
    geo: ['polar', 'permafrost', 'impact', 'tephra'],
  },
  {
    id: 'moon-mare', body: 'moon', name: 'Lunar Mare Plains',
    short: 'Basalt lowlands', lat: 0.67, lon: 23.47,
    blurb: 'Wide, flat plains of dark basalt, like where Apollo 11 landed. Full sunlight, a large swing between day and night temperatures, and fine regolith that is hard on seals and moving parts.',
    ref: { 'Surface temperature': '−173 °C night to +127 °C day', Atmosphere: 'None', 'Day length': '29.5 Earth days', Terrain: 'Flat basaltic plains, < 5° slopes' },
    criteria: [
      { v: 'PRECIP', best: 60, worst: 1000, w: 3 },
      { v: 'T2M_RANGE', best: 18, worst: 5, w: 2 },
      { v: 'CLOUD', best: 15, worst: 70, w: 2 },
      { v: 'SLOPE', best: 1, worst: 15, w: 2 },
      { v: 'SOLAR', best: 7, worst: 3.5, w: 1 },
      { v: 'UV', best: 2.8, worst: 0.8, w: 1 },
      { v: 'LST_SWING', best: 40, worst: 8, w: 3 },
      { v: 'NDVI', best: 0.05, worst: 0.5, w: 2 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 2 },
    ],
    geo: ['basalt', 'tephra', 'impact'],
  },
  {
    id: 'moon-lavatube', body: 'moon', name: 'Lunar Lava Tubes',
    short: 'Marius Hills pit', lat: 14.09, lon: -56.77,
    blurb: 'Skylights into lava tubes (Marius Hills, Mare Tranquillitatis pit). LRO Diviner data show the shaded floor of the Mare Tranquillitatis pit stays near 17 °C, and the rock overhead blocks radiation and micrometeorites, which makes such caves candidate habitat sites.',
    ref: { 'Pit diameter': '≈ 65 m (Marius Hills)', 'Shaded interior temperature': '≈ +17 °C, stable (Mare Tranquillitatis pit, LRO Diviner)', Shielding: 'Natural radiation and impact protection' },
    criteria: [
      { v: 'PRECIP', best: 100, worst: 1200, w: 2 },
      { v: 'T2M_RANGE', best: 16, worst: 5, w: 1 },
      { v: 'CLOUD', best: 20, worst: 75, w: 1 },
      { v: 'RELIEF', best: 150, worst: 5, w: 1 },
      { v: 'NDVI', best: 0.08, worst: 0.5, w: 1 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 1 },
      { v: 'LST_SWING', best: 35, worst: 8, w: 1 },
    ],
    geo: ['lavatube', 'basalt', 'tephra'],
    geoWeight: 0.6,
  },
  {
    id: 'mars-jezero', body: 'mars', name: 'Jezero Crater',
    short: 'Ancient lake delta', lat: 18.38, lon: 77.58,
    blurb: 'An old river delta flowing into a crater lake, now being explored by the Perseverance rover. It has clays and carbonates and is one of the best places to look for signs of ancient life.',
    ref: { 'Mean temperature': '≈ −60 °C', Pressure: '≈ 0.7 kPa (Perseverance MEDA)', Humidity: '≈ 0.03 % water vapour', Geology: 'Delta sediments, clays, carbonates' },
    criteria: [
      { v: 'PRECIP', best: 15, worst: 500, w: 3 },
      { v: 'RH2M', best: 15, worst: 70, w: 2 },
      { v: 'UV', best: 2.8, worst: 1, w: 2 },
      { v: 'T2M', best: -5, worst: 25, w: 1 },
      { v: 'T2M_RANGE', best: 20, worst: 6, w: 1 },
      { v: 'CLOUD', best: 10, worst: 60, w: 1 },
      { v: 'NDVI', best: 0.05, worst: 0.45, w: 2 },
      { v: 'SOILM', best: 3, worst: 30, w: 2 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 1 },
      { v: 'LST_SWING', best: 35, worst: 8, w: 1 },
    ],
    geo: ['sediment', 'clay', 'biosig', 'sterile'],
  },
  {
    id: 'mars-gale', body: 'mars', name: 'Gale Crater & Meridiani',
    short: 'Sulfate layers', lat: -5.4, lon: 137.8,
    blurb: 'Layered sulfate rocks and hematite left behind as acidic, salty water evaporated. Explored by the Curiosity and Opportunity rovers.',
    ref: { Minerals: 'Jarosite, gypsum, hematite', Environment: 'Evaporating acidic brines', Pressure: '≈ 0.7–0.9 kPa (deep crater)' },
    criteria: [
      { v: 'PRECIP', best: 25, worst: 600, w: 3 },
      { v: 'RH2M', best: 20, worst: 75, w: 2 },
      { v: 'T2M_RANGE', best: 18, worst: 6, w: 1 },
      { v: 'SOLAR', best: 7, worst: 3.5, w: 1 },
      { v: 'CLOUD', best: 10, worst: 60, w: 1 },
      { v: 'NDVI', best: 0.05, worst: 0.45, w: 2 },
      { v: 'SOILM', best: 3, worst: 30, w: 2 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 2 },
    ],
    geo: ['evaporite', 'acidic', 'sediment', 'aeolian'],
  },
  {
    id: 'mars-arcadia', body: 'mars', name: 'Arcadia Planitia',
    short: 'Buried ice, crew landing', lat: 40, lon: -150,
    blurb: 'Mid-latitude plains with water ice just under the surface. A leading candidate for crewed landings because the ice could be mined for water and fuel.',
    ref: { 'Ground ice depth': '< 1 m in places', 'Mean temperature': '≈ −70 °C', Landforms: 'Polygonal ground, scalloped terrain' },
    criteria: [
      { v: 'T2M', best: -20, worst: 10, w: 3 },
      { v: 'PRECIP', best: 80, worst: 800, w: 2 },
      { v: 'ABSLAT', best: 72, worst: 40, w: 1 },
      { v: 'SLOPE', best: 1, worst: 12, w: 1 },
      { v: 'RH2M', best: 50, worst: 90, w: 1 },
      { v: 'LST_NIGHT', best: -25, worst: 5, w: 2 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 1 },
      { v: 'NDVI', best: 0.05, worst: 0.45, w: 1 },
    ],
    geo: ['permafrost', 'polar', 'sediment', 'sterile'],
  },
  {
    id: 'mars-tharsis', body: 'mars', name: 'Tharsis Volcanic Highlands',
    short: 'Thin air, high UV', lat: 1.5, lon: -112,
    blurb: 'High volcanic plateau (Arsia, Pavonis and Ascraeus Mons). Very thin air, strong UV, and lava plains made of basalt.',
    ref: { Pressure: '≈ 0.07 kPa (Olympus Mons) to ≈ 0.13 kPa (Arsia Mons) on the summits', UV: 'Unfiltered UV-C at the surface', Geology: 'Shield volcanoes, basalt' },
    criteria: [
      { v: 'PS', best: 55, worst: 98, w: 3 },
      { v: 'UV', best: 3, worst: 1.2, w: 2 },
      { v: 'PRECIP', best: 50, worst: 800, w: 2 },
      { v: 'T2M', best: -5, worst: 25, w: 1 },
      { v: 'RH2M', best: 20, worst: 70, w: 1 },
      { v: 'NDVI', best: 0.05, worst: 0.45, w: 1 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 1 },
      { v: 'LST_SWING', best: 35, worst: 8, w: 1 },
    ],
    geo: ['basalt', 'highalt', 'tephra', 'sterile'],
  },
  {
    id: 'mars-caves', body: 'mars', name: 'Martian Caves',
    short: 'Arsia Mons skylights', lat: -9, lon: -121,
    blurb: 'Pits and collapsed lava tubes on the flanks of the Tharsis volcanoes. They could shelter crews from radiation and may keep ice or microbial life protected.',
    ref: { 'Skylight diameter': '100–250 m', Shielding: 'Protection from radiation and dust storms', Interest: 'Possible ice deposits, sheltered habitats' },
    criteria: [
      { v: 'PRECIP', best: 60, worst: 900, w: 2 },
      { v: 'PS', best: 70, worst: 100, w: 1 },
      { v: 'T2M', best: 0, worst: 25, w: 1 },
      { v: 'RH2M', best: 25, worst: 75, w: 1 },
      { v: 'NDVI', best: 0.08, worst: 0.5, w: 1 },
      { v: 'BARREN', best: 1, worst: 0.2, w: 1 },
    ],
    geo: ['lavatube', 'basalt', 'highalt', 'sterile'],
    geoWeight: 0.6,
  },
];

export const MISSIONS = {
  balanced:  { label: 'Balanced', note: 'Every factor counts as much as the target says it should.', mult: {} },
  rover:     { label: 'Rover & mobility', note: 'Puts more weight on terrain, slope, bare ground and dust: what wheels and navigation need to be tested against.',
               mult: { SLOPE: 2, RELIEF: 2, WIND: 1.5, PRECIP: 1.2, BARREN: 1.6, NDVI: 1.4 } },
  isru:      { label: 'Ice & resources', note: 'Puts more weight on cold, ground ice and latitude, for tests of drilling and water extraction.',
               mult: { T2M: 2, ABSLAT: 1.6, RH2M: 0.6, LST_NIGHT: 2 }, geoBoost: ['permafrost', 'evaporite', 'polar'] },
  astrobio:  { label: 'Astrobiology', note: 'Puts more weight on dryness, UV and life-related geology, for life-detection instrument tests.',
               mult: { PRECIP: 1.6, RH2M: 1.6, UV: 1.6, SOILM: 1.8, NDVI: 1.5 }, geoBoost: ['biosig', 'sterile', 'hydrothermal', 'clay', 'acidic'] },
  habitat:   { label: 'Habitat & crew', note: 'Puts more weight on thermal extremes, clear skies and solar power, for testing habitats and crew operations.',
               mult: { T2M_RANGE: 1.6, SOLAR: 1.6, CLOUD: 1.4, LST_SWING: 1.6 }, geoBoost: ['lavatube'] },
};

// Conditions no place on Earth can reproduce, and how missions close each gap.
// `site` names the Earth variable used to show how far this site is from the real value.
export const GAPS = {
  moon: [
    { what: 'Vacuum', planet: 'Essentially none (≈ 3 × 10⁻¹⁵ of Earth’s pressure)', site: 'PS', lab: 'Thermal-vacuum chambers, e.g. NASA Johnson Chamber A and the Neil Armstrong Test Facility' },
    { what: 'Gravity', planet: '≈ 1/6 g (0.165 g)', lab: 'Reduced-gravity parabolic flights and the ARGOS offload system at NASA Johnson' },
    { what: 'Radiation', planet: 'No atmosphere or magnetic field; solar particle events and cosmic rays reach the surface', lab: 'NASA Space Radiation Laboratory (Brookhaven) for materials and biology' },
    { what: 'Regolith', planet: 'Sharp, electrostatically charged dust that has never been weathered by water', lab: 'Lunar regolith simulants (e.g. LHS-1, JSC-1A) in “dirty” vacuum chambers' },
    { what: 'Day–night cycle', planet: '≈ 14.8 Earth days of sunlight, then ≈ 14.8 days of darkness; the surface swings by ≈ 300 °C', site: 'LST_SWING', lab: 'Thermal-cycling chambers; polar sites help with low sun angles' },
  ],
  mars: [
    { what: 'Atmospheric pressure', planet: '≈ 0.6 kPa, 95 % CO₂', site: 'PS', lab: 'Mars simulation chambers, e.g. NASA Ames MARSWIT and the Aarhus Mars Simulation Wind Tunnel' },
    { what: 'Gravity', planet: '0.38 g', lab: 'Mars-profile parabolic flights and gravity-offload rigs' },
    { what: 'Cold', planet: 'Mean ≈ −60 °C, nights below −80 °C', site: 'T2M', lab: 'Climate chambers; Antarctic sites come closest outdoors' },
    { what: 'Radiation', planet: '≈ 0.64 mSv per day at the surface (Curiosity RAD, Hassler et al. 2014)', lab: 'NASA Space Radiation Laboratory (Brookhaven)' },
    { what: 'Soil chemistry', planet: 'Perchlorate ≈ 0.4–0.6 wt % (Phoenix), strongly oxidising; organics are rare and degraded near the surface', lab: 'Mars regolith simulants (e.g. MGS-1) spiked with perchlorate' },
  ],
};
