import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, INDEX_FILL, APPREC_FILL, VALUE_FILL } from './basemap-style.js';
import { initSearch } from './search.js';
import { initFindings } from './findings.js';
import { verdictFor, formatPrice, ordinal } from './verdict.js';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

// Starting point only: unless the URL carries a view, the map immediately fits
// itself to the data instead, so London fills the window at any screen size.
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

const CITIES = ['london', 'manchester', 'liverpool'];

/** Slug from ?city=, falling back to London. */
function requestedCity() {
  const q = new URLSearchParams(location.search).get('city');
  return CITIES.includes(q) ? q : 'london';
}

const cityFiles = (slug) =>
  Promise.all(
    ['hexes.geojson', 'summary.json', 'pois.geojson', 'districts.json'].map((f) =>
      fetch(`${DATA_BASE}${slug}/${f}`).then((r) => r.json()),
    ),
  );

let city = requestedCity();
const [hexData, summary, poiData, districts] = await cityFiles(city);
// The Banana is a London artefact, so it lives outside the per-city folders.
const bananaData = await fetch(`${DATA_BASE}banana.geojson`).then((r) => r.json());

// h3 index -> feature properties, for the postcode lookup. Rebuilt on each
// city switch, so it is a `let` the search closure reads through.
let hexProps = new Map(hexData.features.map((f) => [f.properties.h3, f.properties]));

// Must be read before the map exists: constructing it with hash:true starts
// writing the view into the URL, after which this can never look empty.
const hadSharedView = Boolean(location.hash);

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(hexData, poiData, bananaData),
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

/**
 * Re-frame the city, unless the view came from the URL or the user has taken
 * over. A fit is only as good as the container size it was measured against,
 * and that size is often wrong until well after startup.
 */
function refitIfUntouched() {
  if (!hadSharedView && !hasUserMoved) map.fitBounds(HOME_BOUNDS, FIT);
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
  apprec: { title: 'Price growth', labels: ['1.35×', '1.9×', '2.4×+'], fill: APPREC_FILL },
  value: { title: 'Value spots', labels: ['low', '', 'best value'], fill: VALUE_FILL },
};

const HEX_LAYERS = ['hex-fill', 'hex-outline'];

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

  if (map.getLayer('hex-fill')) {
    map.setPaintProperty('hex-fill', 'fill-color', MODES[mode].fill);
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
  infoVerdict.textContent = `${v.label} · ${ordinal(p.pct)} percentile`;
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

// --- City switcher ---
const cityBar = document.getElementById('cities');

/** Swap every per-city dataset in place, then re-frame the map. */
async function switchCity(slug) {
  if (slug === city || !CITIES.includes(slug)) return;
  cityBar.setAttribute('aria-busy', 'true');

  const [hex, sum, poi, dist] = await cityFiles(slug);
  city = slug;

  map.getSource('hexes').setData(hex);
  map.getSource('pois').setData(poi);
  hexProps = new Map(hex.features.map((f) => [f.properties.h3, f.properties]));
  searchCtx.hexProps = hexProps;
  searchCtx.districts = dist;
  searchCtx.cityName = sum.city;

  // The Banana is a London claim; offering it over Manchester would be
  // meaningless, so the control goes away with the city.
  const bananaRow = document.getElementById('toggle-banana').closest('.toggle');
  const bananaOn = document.getElementById('toggle-banana');
  bananaRow.hidden = slug !== 'london';
  if (slug !== 'london' && bananaOn.checked) {
    bananaOn.checked = false;
    bananaOn.dispatchEvent(new Event('change'));
  }

  initFindings(sum);
  document.getElementById('result').hidden = true;

  // A new city means the old view is meaningless, so re-frame regardless of
  // whether the user had panned around the previous one.
  HOME_BOUNDS = dataBounds(hex);
  hasUserMoved = false;
  // Jump, don't animate. Animated moves are driven by the render loop, so a
  // stalled basemap leaves the camera stranded mid-flight — and flying 200
  // miles between cities is disorienting rather than informative anyway.
  map.fitBounds(HOME_BOUNDS, FIT);

  for (const b of cityBar.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.city === slug));
  }
  const url = new URL(location.href);
  url.searchParams.set('city', slug);
  history.replaceState(null, '', url);
  cityBar.removeAttribute('aria-busy');
}

for (const b of cityBar.querySelectorAll('button')) {
  b.setAttribute('aria-pressed', String(b.dataset.city === city));
  b.addEventListener('click', () => switchCity(b.dataset.city));
}
document.getElementById('toggle-banana').closest('.toggle').hidden = city !== 'london';

map.on('error', (e) => console.warn('map error:', e.error?.message ?? e));

if (import.meta.env.DEV) {
  window.map = map; // debugging handle
}
