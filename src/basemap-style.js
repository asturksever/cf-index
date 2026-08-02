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
  chicken: '#E8590C', // fried-chicken orange
  chickenMid: '#F4A261',
  neutral: '#F5F1E6', // cream
  coffeeMid: '#66A5AD',
  coffee: '#0B7285', // flat-white teal
};

/**
 * @param {object} hexData parsed GeoJSON FeatureCollection of index hexes
 */
export function buildStyle(hexData) {
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
          // Non-linear stops: London has ~8× more cafés than chicken shops, so
          // scores pile up near +1 (median 0.82). Spacing the teal stops toward
          // the top keeps cream = balanced while giving the coffee side visible
          // dynamic range; the rare chicken-leaning hexes still pop orange.
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'score'],
            -1, COLORS.chicken,
            -0.45, COLORS.chickenMid,
            0, COLORS.neutral,
            0.55, '#A8C8CD',
            0.85, '#4E96A3',
            1, COLORS.coffee,
          ],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.65, 13, 0.5, 16, 0.35],
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
