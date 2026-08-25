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

// Value spots — the Londonist coffee-and-chicken method. Only the top of the
// range gets colour: the question is "where is this a bargain", so mid and
// negative values stay near-neutral rather than competing for attention.
// Stops follow the observed spread (5th-95th pct: -0.48 to +0.61).
export const VALUE_FILL = [
  'case',
  ['!', ['has', 'value']],
  'rgba(51, 48, 43, 0.08)',
  [
    'interpolate',
    ['linear'],
    ['get', 'value'],
    -0.5, '#FBFAF7',
    0, '#F0EAF6',
    0.25, '#D5C2E8',
    0.45, '#A87FD1',
    0.65, '#7038B0',
    0.85, '#3F1D6B',
  ],
];

/**
 * @param {object} hexData parsed GeoJSON FeatureCollection of index hexes
 * @param {object} poiData parsed GeoJSON FeatureCollection of raw POI points
 * @param {object} bananaData parsed GeoJSON of the London Banana polygon
 */
// Where the coarse tier hands over to the detailed one. Below this a res-9 hex
// is sub-pixel; above it, res-6 cells are bigger than the screen.
export const COARSE_MAXZOOM = 8.5;

export function buildStyle(hexData, poiData, bananaData, coarseData) {
  return {
    version: 8,
    name: 'CFC Index — latte & terracotta',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openfreemap: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
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
      hexesCoarse: {
        type: 'geojson',
        data: coarseData,
      },
      banana: {
        type: 'geojson',
        data: bananaData,
        attribution:
          'London Banana: <a href="https://x.com/Saul_Sadka/status/1959609109939892706" target="_blank" rel="noopener">Saul Sadka</a> (indicative)',
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
      // --- The London Banana (toggled, off by default) ---
      // The wash goes UNDER the hexes, not over them. Yellow over the index's
      // teal end makes green — a colour that is not on the legend and is the
      // coffee-density layer's hue — so an overlay wash misreported the data at
      // any opacity worth seeing. Underneath, the hexes keep their own colour
      // and the yellow reads through the gaps instead. The outline goes on top
      // (below) and is what actually delineates the region.
      {
        id: 'banana-fill',
        type: 'fill',
        source: 'banana',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': '#FFD400',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 13, 0.35, 16, 0.25],
        },
      },
      // --- the index (the data!) ---
      // Two tiers of the same metric: res 6 while zoomed out, res 9 once close
      // enough for it to be legible. Only one is ever visible.
      {
        id: 'hex-coarse-fill',
        type: 'fill',
        source: 'hexesCoarse',
        maxzoom: COARSE_MAXZOOM,
        paint: {
          'fill-color': INDEX_FILL,
          'fill-opacity': 0.75,
        },
      },
      {
        id: 'hex-fill',
        minzoom: COARSE_MAXZOOM,
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
          // Green, not teal: teal is the index's own coffee end, so a teal
          // heatmap over teal hexes was impossible to tell apart. Green is the
          // one hue no other layer uses — the index is orange/teal, both price
          // modes are purple, chicken density is orange/brown.
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(11,61,20,0)',
            0.08, 'rgba(124,179,66,0.35)',
            0.3, '#7CB342',
            0.6, '#3E8E41',
            0.85, '#1B5E20',
            1, '#0B3D14',
          ],
          'heatmap-opacity': 0.8,
        },
      },
      {
        id: 'banana-outline',
        type: 'line',
        source: 'banana',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#E8A400',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 13, 3.5, 16, 4.5],
          'line-opacity': 1,
          // dashed, because a solid ring would imply a precision this freehand
          // outline does not have — the original stroke is 1–2 km wide
          'line-dasharray': [3, 2],
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
