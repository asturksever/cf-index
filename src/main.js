import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle } from './basemap-style.js';
import { initSearch } from './search.js';
import { initScatter } from './scatter.js';
import { verdictFor, formatPrice } from './verdict.js';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

const HOME = { center: [-0.118, 51.5074], zoom: 9.7 };

const [hexData, summary] = await Promise.all([
  fetch(`${DATA_BASE}hexes.geojson`).then((r) => r.json()),
  fetch(`${DATA_BASE}summary.json`).then((r) => r.json()),
]);

// h3 index -> feature properties, for the postcode lookup
const hexProps = new Map(hexData.features.map((f) => [f.properties.h3, f.properties]));

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(hexData),
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

// --- Hover info card ---
const info = document.getElementById('info');
const infoScore = document.getElementById('info-score');
const infoVerdict = document.getElementById('info-verdict');
const infoCounts = document.getElementById('info-counts');
const infoPrice = document.getElementById('info-price');

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
  info.hidden = false; // unhide before measuring, so the card has a layout box
  positionInfoCard(point);
  map.getCanvas().style.cursor = 'crosshair';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
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

initSearch(map, hexProps);
initScatter(summary);

map.on('error', (e) => console.warn('map error:', e.error?.message ?? e));

if (import.meta.env.DEV) {
  window.map = map; // debugging handle
}
