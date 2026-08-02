import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, INDEX_FILL, APPREC_FILL } from './basemap-style.js';
import { initSearch } from './search.js';
import { initScatter } from './scatter.js';
import { verdictFor, formatPrice, ordinal } from './verdict.js';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

const HOME = { center: [-0.118, 51.5074], zoom: 9.7 };

const [hexData, summary, poiData, districts] = await Promise.all([
  fetch(`${DATA_BASE}hexes.geojson`).then((r) => r.json()),
  fetch(`${DATA_BASE}summary.json`).then((r) => r.json()),
  fetch(`${DATA_BASE}pois.geojson`).then((r) => r.json()),
  fetch(`${DATA_BASE}districts.json`).then((r) => r.json()),
]);

// h3 index -> feature properties, for the postcode lookup
const hexProps = new Map(hexData.features.map((f) => [f.properties.h3, f.properties]));

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(hexData, poiData),
  ...HOME,
  hash: true,
  attributionControl: false,
});

// Belt-and-braces: if the container had no size at construction (embedded
// panes, hidden tabs), MapLibre falls back to a 400×300 canvas and its own
// observer doesn't always recover. An extra resize is a no-op when sizes match.
map.once('load', () => map.resize());
new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
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
  { input: 'toggle-hexes', layers: ['hex-fill', 'hex-outline'] },
  { input: 'toggle-heat-coffee', layers: ['heat-coffee'] },
  { input: 'toggle-heat-chicken', layers: ['heat-chicken'] },
  { input: 'toggle-buildings', layers: ['building-3d'] },
  { input: 'toggle-satellite', layers: ['satellite'] },
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
const LEGEND_TEXT = {
  index: {
    title: 'The index',
    labels: ['🍗 −1', '0', '+1 ☕'],
    note: 'score = (coffee − chicken) / (coffee + chicken), smoothed over neighbouring hexes. Grey gaps = fewer than two shops nearby.',
  },
  apprec: {
    title: 'Price growth',
    labels: ['1.35×', '1.9×', '2.4×+'],
    note: `How many times over the median sale price has multiplied since ${summary.apprec.y0}, for the hex's postcode district. Grey = too few sales to measure.`,
  },
};

function applyHexMode() {
  const mode = document.getElementById('mode-apprec').checked ? 'apprec' : 'index';
  if (map.getLayer('hex-fill')) {
    map.setPaintProperty('hex-fill', 'fill-color', mode === 'apprec' ? APPREC_FILL : INDEX_FILL);
  }
  legendEl.classList.toggle('apprec', mode === 'apprec');
  legendTitle.textContent = LEGEND_TEXT[mode].title;
  document.getElementById('legend-note').textContent = LEGEND_TEXT[mode].note;
  legendLabels.replaceChildren(
    ...LEGEND_TEXT[mode].labels.map((t) => {
      const span = document.createElement('span');
      span.textContent = t;
      return span;
    }),
  );
}
for (const id of ['mode-index', 'mode-apprec']) {
  document.getElementById(id).addEventListener('change', applyHexMode);
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
  infoCounts.textContent = `☕ ${p.c} in hex (${p.cs} nearby) · 🍗 ${p.f} in hex (${p.fs} nearby)`;
  infoPrice.textContent = p.price
    ? `median sale ${formatPrice(p.price)} (${p.n} sales)`
    : 'too few recent sales for a median';
  infoGrowth.textContent =
    p.outcode && p.apprec ? `${p.outcode}: ${p.apprec}× since ${summary.apprec.y0}` : '';
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

initSearch(map, hexProps, districts);
initScatter(summary);

map.on('error', (e) => console.warn('map error:', e.error?.message ?? e));

if (import.meta.env.DEV) {
  window.map = map; // debugging handle
}
