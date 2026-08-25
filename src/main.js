import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cellToBoundary } from 'h3-js';
import { buildStyle, INDEX_FILL, APPREC_FILL, VALUE_FILL } from './basemap-style.js';
import { initSearch } from './search.js';
import { initFindings } from './findings.js';
import { verdictFor, formatPrice, ordinal } from './verdict.js';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

// Construction-time camera only; setCamera() re-points it at the chosen view
// (London unless ?view= says otherwise) as soon as the map exists. Matching
// London here avoids a visible flash of the wrong part of the country.
const HOME = { center: [-0.118, 51.5074], zoom: 9.7 };

/** Bounding box of every scored hexagon, as [[w, s], [e, n]]. */
function dataBounds(fc) {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const f of fc.features) {
    for (const [lng, lat] of f.geometry.coordinates[0]) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return [
    [w, s],
    [e, n],
  ];
}

// One national dataset now, so these are camera presets rather than separate
// builds. 'uk' means "fit the whole thing"; the rest are jump-to shortcuts.
const VIEWS = {
  all: { label: 'All' },
  london: { label: 'London', center: [-0.118, 51.507], zoom: 9.6 },
  birmingham: { label: 'Birmingham', center: [-1.9, 52.48], zoom: 10.2 },
  manchester: { label: 'Manchester', center: [-2.24, 53.48], zoom: 10.2 },
  leeds: { label: 'Leeds', center: [-1.55, 53.8], zoom: 10.2 },
  bristol: { label: 'Bristol', center: [-2.59, 51.45], zoom: 10.4 },
};

const DATA_SLUG = 'engwales';

/** View preset from ?view=. London is the default: the index is a
 *  within-city signal, and nationally it barely correlates with price
 *  (rho +0.04 against +0.39 in London), so opening on the country would
 *  lead with the map's weakest reading. "All" stays a click away. */
function requestedView() {
  const q = new URLSearchParams(location.search).get('view');
  return q in VIEWS ? q : 'london';
}

const cityFiles = (slug) =>
  Promise.all(
    ['hexes.json', 'summary.json', 'districts.json', 'hexes_coarse.json'].map((f) =>
      fetch(`${DATA_BASE}${slug}/${f}`).then((r) => r.json()),
    ),
  );

// The national POI file is ~7.7 MB and both density layers are off by default,
// so it is fetched the first time one is switched on rather than on every load.
let poiLoad = null;
const loadPois = () =>
  (poiLoad ??= fetch(`${DATA_BASE}${DATA_SLUG}/pois.geojson`)
    .then((r) => r.json())
    .then((data) => {
      map.getSource('pois')?.setData(data);
      return data;
    }));

/**
 * Rebuild hex polygons from their H3 ids.
 *
 * The pipeline ships ids plus properties and leaves the geometry to us: a
 * ring is seven coordinate pairs derivable from the id, and at UK scale that
 * boilerplate would be most of the download. ~40k cells rebuild in well under
 * a frame, and it happens once per city load.
 */
function hexesToGeoJSON({ hexes }) {
  return {
    type: 'FeatureCollection',
    features: hexes.map((props) => {
      const ring = cellToBoundary(props.h3, true); // true = [lng, lat]
      ring.push(ring[0]);
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: props,
      };
    }),
  };
}

let view = requestedView();
const [hexRaw, summary, districts, coarseRaw] = await cityFiles(DATA_SLUG);
const coarseData = hexesToGeoJSON(coarseRaw);
// Empty until a density layer asks for it; the source must still exist at
// style-build time so the heatmap layers have something to attach to.
const poiData = { type: 'FeatureCollection', features: [] };
const hexData = hexesToGeoJSON(hexRaw);
// The Banana is a London artefact, so it lives outside the per-city folders.
const bananaData = await fetch(`${DATA_BASE}banana.geojson`).then((r) => r.json());

// h3 index -> feature properties, for the postcode lookup. Rebuilt on each
// city switch, so it is a `let` the search closure reads through.
let hexProps = new Map(hexRaw.hexes.map((h) => [h.h3, h]));

// Must be read before the map exists: constructing it with hash:true starts
// writing the view into the URL, after which this can never look empty.
const hadSharedView = Boolean(location.hash);

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(hexData, poiData, bananaData, coarseData),
  ...HOME,
  hash: true,
  attributionControl: false,
});

// A fixed zoom frames London differently on a laptop and an ultrawide, so fit
// the data instead. Skipped when the URL already carries a view, which is what
// a shared or reloaded link relies on.
let HOME_BOUNDS = dataBounds(hexData);
const FIT = { padding: 30, animate: false };

// Only genuine input counts: camera events carry an originalEvent when the user
// caused them, and fitBounds itself fires zoomstart without one.
let hasUserMoved = false;
for (const ev of ['dragstart', 'zoomstart', 'rotatestart']) {
  map.on(ev, (e) => {
    if (e?.originalEvent) hasUserMoved = true;
  });
}

/** Point the camera at a view preset. "all" fits the national extent; every
 *  other preset is a fixed centre/zoom. Chrome and URL are handled by
 *  applyView — this is camera only, so the resize refit can reuse it. */
function setCamera(name) {
  const preset = VIEWS[name];
  if (!preset) return;
  if (name === 'all') {
    map.fitBounds(HOME_BOUNDS, FIT);
  } else {
    // Always jump, never ease. Animated camera moves are driven by the render
    // loop, so a slow or stalled basemap strands the camera mid-flight — and
    // these hops cross the country, where an animation is disorienting anyway.
    map.jumpTo({ center: preset.center, zoom: preset.zoom });
  }
}

/**
 * Re-frame the *current* view, unless it came from the URL or the user has
 * taken over. A fit is only as good as the container size it was measured
 * against, and that size is often wrong until well after startup — but it has
 * to re-apply the view on screen, not always snap back to the whole country.
 */
function refitIfUntouched() {
  if (!hadSharedView && !hasUserMoved) setCamera(view);
}

refitIfUntouched();

// Belt-and-braces: if the container had no size at construction (embedded
// panes, hidden tabs), MapLibre falls back to a 400×300 canvas and its own
// observer doesn't always recover. An extra resize is a no-op when sizes match.
map.once('load', () => {
  map.resize();
  refitIfUntouched();
});
new ResizeObserver(() => {
  map.resize();
  refitIfUntouched();
}).observe(document.getElementById('map'));

// No NavigationControl: scroll/pinch to zoom and right-drag to rotate keep the
// map clean of chrome.
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

// MapLibre re-adds 'maplibregl-compact-show' during load (resize event triggers
// _updateCompact). Force collapse until the user clicks ⓘ.
{
  const attribEl = document.querySelector('.maplibregl-ctrl-attrib');
  if (attribEl) {
    const summaryEl = attribEl.querySelector('summary');
    let userInteracted = false;
    const forceCollapse = () => {
      if (userInteracted) return;
      attribEl.classList.remove('maplibregl-compact-show');
      attribEl.setAttribute('open', '');
    };
    forceCollapse();
    const observer = new MutationObserver(() => {
      if (!userInteracted && attribEl.classList.contains('maplibregl-compact-show')) {
        forceCollapse();
      }
    });
    observer.observe(attribEl, { attributes: true, attributeFilter: ['class', 'open'] });
    summaryEl?.addEventListener('click', () => {
      userInteracted = true;
      setTimeout(() => observer.disconnect(), 100);
    });
  }
}

// --- Layer toggles ---
const LAYER_TOGGLES = [
  { input: 'toggle-heat-coffee', layers: ['heat-coffee'] },
  { input: 'toggle-heat-chicken', layers: ['heat-chicken'] },
  { input: 'toggle-banana', layers: ['banana-fill', 'banana-outline'] },
];
for (const { input, layers } of LAYER_TOGGLES) {
  const checkbox = document.getElementById(input);
  const apply = () => {
    if (checkbox.checked && layers.some((l) => l.startsWith('heat-'))) loadPois();
    for (const layer of layers) {
      if (!map.getLayer(layer)) continue;
      map.setLayoutProperty(layer, 'visibility', checkbox.checked ? 'visible' : 'none');
    }
  };
  checkbox.addEventListener('change', apply);
  map.on('load', apply);
}

// --- Hex colouring mode: index score vs district price growth ---
const legendTitle = document.getElementById('legend-title');
const legendLabels = document.getElementById('legend-labels');
const legendEl = document.getElementById('legend');
const MODES = {
  index: { title: 'The index', labels: ['🐔 −1', '0', '+1 ☕'], fill: INDEX_FILL },
  apprec: { title: 'Price growth', labels: ['1.35×', '1.72×', '2.15×+'], fill: APPREC_FILL },
  value: { title: 'Value spots', labels: ['low', '', 'best value'], fill: VALUE_FILL },
};

const HEX_LAYERS = ['hex-fill', 'hex-outline', 'hex-coarse-fill'];

function applyHexMode() {
  const mode = Object.keys(MODES).find((m) => document.getElementById(`mode-${m}`).checked);

  // No colouring selected means the user switched the hexes off entirely.
  for (const layer of HEX_LAYERS) {
    if (map.getLayer(layer)) {
      map.setLayoutProperty(layer, 'visibility', mode ? 'visible' : 'none');
    }
  }
  legendEl.hidden = !mode;
  if (!mode) return;

  // Both tiers share the colouring; only the coarse one lacks price-derived
  // props, so growth/value simply render as its no-data grey when zoomed out.
  for (const layer of ['hex-fill', 'hex-coarse-fill']) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, 'fill-color', MODES[mode].fill);
  }
  for (const m of Object.keys(MODES)) legendEl.classList.toggle(m, m === mode);
  legendTitle.textContent = MODES[mode].title;
  legendLabels.replaceChildren(
    ...MODES[mode].labels.map((t) => {
      const span = document.createElement('span');
      span.textContent = t;
      return span;
    }),
  );
}

for (const id of Object.keys(MODES)) {
  document.getElementById(`mode-${id}`).addEventListener('change', (e) => {
    // Mutually exclusive by hand, since checkboxes have no grouping of their own.
    if (e.target.checked) {
      for (const other of Object.keys(MODES)) {
        if (other !== id) document.getElementById(`mode-${other}`).checked = false;
      }
    }
    applyHexMode();
  });
}
map.on('load', applyHexMode);

// --- Hover info card ---
const info = document.getElementById('info');
const infoScore = document.getElementById('info-score');
const infoVerdict = document.getElementById('info-verdict');
const infoCounts = document.getElementById('info-counts');
const infoPrice = document.getElementById('info-price');
const infoGrowth = document.getElementById('info-growth');

const INFO_GAP = 14;

/** Place the card near the cursor, flipping so it never leaves the viewport. */
function positionInfoCard(point) {
  const canvas = map.getCanvas();
  const { width, height } = info.getBoundingClientRect();
  let x = point.x + INFO_GAP;
  let y = point.y + INFO_GAP;
  if (x + width > canvas.clientWidth) x = point.x - INFO_GAP - width;
  if (y + height > canvas.clientHeight) y = point.y - INFO_GAP - height;
  info.style.left = `${Math.max(INFO_GAP, x)}px`;
  info.style.top = `${Math.max(INFO_GAP, y)}px`;
}

function updateInfoCard(point) {
  if (!map.getLayer('hex-fill')) return;
  const features = map.queryRenderedFeatures(
    [
      [point.x - 2, point.y - 2],
      [point.x + 2, point.y + 2],
    ],
    { layers: ['hex-fill'] },
  );
  if (!features.length) {
    info.hidden = true;
    map.getCanvas().style.cursor = '';
    return;
  }
  const p = features[0].properties;
  const v = verdictFor(p.score);
  infoScore.textContent = `${p.score > 0 ? '+' : ''}${p.score.toFixed(2)}`;
  infoScore.style.color = v.color;
  infoVerdict.textContent = `${v.label} · ${ordinal(p.pct)} percentile locally`;
  infoCounts.textContent = `☕ ${p.c} in hex (${p.cs} nearby) · 🐔 ${p.f} in hex (${p.fs} nearby)`;
  infoPrice.textContent = p.price
    ? `median sale ${formatPrice(p.price)} (${p.n} sales)`
    : 'too few recent sales for a median';
  const bits = [];
  if (p.outcode && p.apprec) bits.push(`${p.outcode}: ${p.apprec}× since ${summary.apprec.y0}`);
  if (p.value != null) bits.push(`value ${p.value > 0 ? '+' : ''}${p.value.toFixed(2)}`);
  infoGrowth.textContent = bits.join(' · ');
  info.hidden = false; // unhide before measuring, so the card has a layout box
  positionInfoCard(point);
  map.getCanvas().style.cursor = 'crosshair';
}

// coalesce queryRenderedFeatures to one lookup per frame
let pendingPoint = null;
let rafHandle = 0;
map.on('mousemove', (e) => {
  pendingPoint = e.point;
  if (rafHandle) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = 0;
    updateInfoCard(pendingPoint);
  });
});

map.on('mouseout', () => {
  if (rafHandle) {
    cancelAnimationFrame(rafHandle);
    rafHandle = 0;
  }
  info.hidden = true;
  map.getCanvas().style.cursor = '';
});

// A postcode lookup flies the camera programmatically, which carries no
// originalEvent — without this a later window resize would re-frame London and
// throw away the place the user just looked up.
// Mutated in place by switchCity, so the search handlers always see the
// city currently on screen without being re-bound (which would double up
// their event listeners).
const searchCtx = {
  hexProps,
  districts,
  cityName: summary.city,
  // The Banana never changes with the city; the checkbox (hidden and force-
  // unchecked outside London) is the gate, so the ring can just sit here.
  bananaRing: bananaData.features[0].geometry.coordinates[0],
};
initSearch(map, searchCtx, () => {
  hasUserMoved = true;
});
initFindings(summary);

// --- View switcher ---
// One national dataset, so switching is purely a camera move: no refetch, no
// source swap, no per-view copy to keep in sync.
const cityBar = document.getElementById('cities');

function applyView(name) {
  if (!(name in VIEWS)) return;
  view = name;

  hasUserMoved = false;
  setCamera(name);

  for (const b of cityBar.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === name));
  }
  const url = new URL(location.href);
  if (name === 'london') url.searchParams.delete('view');
  else url.searchParams.set('view', name);
  history.replaceState(null, '', url);
}

for (const b of cityBar.querySelectorAll('button')) {
  b.setAttribute('aria-pressed', String(b.dataset.view === view));
  b.addEventListener('click', () => applyView(b.dataset.view));
}

// Point the camera at the starting view. A hash in the URL is a more specific
// instruction (someone shared an exact camera), so it wins. No hasUserMoved
// hack needed any more: refitIfUntouched re-applies this same view on resize.
if (!hadSharedView) setCamera(view);

map.on('error', (e) => console.warn('map error:', e.error?.message ?? e));

if (import.meta.env.DEV) {
  window.map = map; // debugging handle
}
