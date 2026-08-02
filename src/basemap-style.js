// Warm "latte & terracotta" light basemap over OpenFreeMap vector tiles
// (OpenMapTiles schema) + optional satellite + the CFC index hex layer.

const COLORS = {
  ground: '#FAF7F2', // steamed-milk white
  water: '#C9DCE6',
  park: '#E8EEE4',
  roadMinor: '#EAE4DB',
  roadMajor: '#DDD5C8',
  building: '#EDE8E0',
  buildingTop: '#D5CCBF',
  label: '#33302B',
  labelHalo: '#FFFFFF',
  coffee: '#0B7285', // UI accent (buttons, links) — not the data ramp
};

// The one place the index ramp is defined. Stops are non-linear because London
// has ~8× more cafés than chicken shops, so scores pile up near +1 (median
// 0.82): the teal side gets most of the resolution, the neutral sits at 0 so
// "balanced" still reads as balanced, and the rare chicken hexes stay loud.
// style.css mirrors these as gradient percentages — keep them in sync.
export const RAMP = [
  [-1, '#C2410C'],
  [-0.45, '#F76707'],
  [0, '#FCFBF8'],
  [0.55, '#74B8C4'],
  [0.85, '#23859C'],
  [1, '#084C61'],
];

export const INDEX_FILL = ['interpolate', ['linear'], ['get', 'score'], ...RAMP.flat()];

// Sequential purple, deliberately nothing like the diverging index ramp so the
// two colouring modes can never be confused. Hexes whose district lacks enough
// sales for a 2011 baseline render as faint grey rather than a fake value.
export const APPREC_FILL = [
  'case',
  ['!', ['has', 'apprec']],
  'rgba(51, 48, 43, 0.08)',
  [
    'interpolate',
    ['linear'],
    ['get', 'apprec'],
    // Stops track the observed district spread (5th–95th pct: 1.42×–2.26×),
    // not a round-number guess, or almost every hex lands on one colour.
    1.35, '#F6F3FB',
    1.6, '#CDBBE6',
    1.9, '#A583D1',
    2.1, '#7A4BBF',
    2.4, '#46246E',
  ],
];

/**
 * @param {object} hexData parsed GeoJSON FeatureCollection of index hexes
 * @param {object} poiData parsed GeoJSON FeatureCollection of raw POI points
 */
export function buildStyle(hexData, poiData) {
  return {
    version: 8,
    name: 'CFC Index — latte & terracotta',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openfreemap: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
      satellite: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
      },
      hexes: {
        type: 'geojson',
        data: hexData,
        attribution:
          'POIs: Overture Maps Foundation (CDLA-P 2.0) · Prices: HM Land Registry (OGL v3)',
      },
      pois: {
        type: 'geojson',
        data: poiData,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': COLORS.ground } },
      {
        id: 'park',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'park',
        paint: { 'fill-color': COLORS.park, 'fill-opacity': 0.9 },
      },
      {
        id: 'landuse-green',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['wood', 'grass', 'forest'], true, false],
        paint: { 'fill-color': COLORS.park, 'fill-opacity': 0.6 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'water',
        paint: { 'fill-color': COLORS.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'waterway',
        paint: { 'line-color': COLORS.water, 'line-width': 1.2 },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false],
        paint: {
          'line-color': COLORS.roadMinor,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 0.5, 14, 2, 18, 10],
        },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 5,
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
          true,
          false,
        ],
        paint: {
          'line-color': COLORS.roadMajor,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.6, 10, 1.4, 14, 5, 18, 20],
        },
      },
      // --- satellite imagery (toggled from the UI) ---
      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        layout: { visibility: 'none' },
        paint: {
          'raster-brightness-max': 0.95,
          'raster-saturation': -0.2,
        },
      },
      // --- the index (the data!) ---
      {
        id: 'hex-fill',
        type: 'fill',
        source: 'hexes',
        paint: {
          'fill-color': INDEX_FILL,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.72, 13, 0.55, 16, 0.4],
        },
      },
      {
        id: 'hex-outline',
        type: 'line',
        source: 'hexes',
        minzoom: 12,
        paint: {
          'line-color': 'rgba(51, 48, 43, 0.14)',
          'line-width': 0.75,
        },
      },
      // --- 3D buildings (toggled, off by default) ---
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 13.5,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'render_height'], 5],
            0, COLORS.building,
            60, COLORS.buildingTop,
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
        },
      },
      // --- raw POI density (toggled, off by default) ---
      // Intensities are tuned per layer, not shared: heatmap density is additive,
      // so the ~8:1 coffee:chicken point ratio would saturate the coffee layer to
      // solid colour at any intensity that makes the chicken layer visible. Each
      // ramp is calibrated to read well on its own — the two are NOT comparable
      // to each other by colour. Use the index hexes for that comparison.
      {
        id: 'heat-chicken',
        type: 'heatmap',
        source: 'pois',
        filter: ['==', ['get', 'k'], 'f'],
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.16, 13, 0.42, 16, 0.9],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 22, 16, 40],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(194,65,12,0)',
            0.08, 'rgba(247,103,7,0.35)',
            0.3, '#F9A03F',
            0.6, '#F76707',
            0.85, '#D9480F',
            1, '#7C2D12',
          ],
          'heatmap-opacity': 0.8,
        },
      },
      {
        id: 'heat-coffee',
        type: 'heatmap',
        source: 'pois',
        filter: ['==', ['get', 'k'], 'c'],
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.09, 13, 0.22, 16, 0.45],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 12, 22, 16, 40],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(8,76,97,0)',
            0.08, 'rgba(116,184,196,0.35)',
            0.3, '#74B8C4',
            0.6, '#2E9BB0',
            0.85, '#0B7285',
            1, '#084C61',
          ],
          'heatmap-opacity': 0.8,
        },
      },
      // --- labels ---
      {
        id: 'place-city',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 16],
        },
        paint: {
          'text-color': COLORS.label,
          'text-halo-color': COLORS.labelHalo,
          'text-halo-width': 1.6,
        },
      },
      {
        id: 'place-suburb',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        minzoom: 10.5,
        filter: ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'quarter'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
        },
        paint: {
          'text-color': COLORS.label,
          'text-halo-color': COLORS.labelHalo,
          'text-halo-width': 1.3,
          'text-opacity': 0.85,
        },
      },
    ],
  };
}

export { COLORS };
