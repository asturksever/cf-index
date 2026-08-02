// Postcode lookup: postcodes.io (free, CORS-friendly) -> h3 cell -> hex props.
import maplibregl from 'maplibre-gl';
import { latLngToCell } from 'h3-js';
import { verdictFor, formatPrice, ordinal } from './verdict.js';
import { sparkline } from './sparkline.js';

const RES = 9;

export function initSearch(map, hexProps, districts) {
  const form = document.getElementById('search');
  const input = document.getElementById('pc-input');
  const result = document.getElementById('result');
  const closeBtn = document.getElementById('result-close');
  const title = document.getElementById('result-title');
  const verdict = document.getElementById('result-verdict');
  const meterDot = document.getElementById('result-meter-dot');
  const detail = document.getElementById('result-detail');
  const price = document.getElementById('result-price');
  const history = document.getElementById('result-history');
  const spark = document.getElementById('result-spark');
  const historyNote = document.getElementById('result-history-note');

  let marker = null;

  /** Draw the district's price history, falling back to the London-wide series. */
  function showHistory(outcode) {
    const own = districts?.[outcode];
    const d = own ?? districts?._london;
    const svg = d ? sparkline(d.m, d.y0) : '';
    if (!svg) {
      history.hidden = true;
      return;
    }
    spark.innerHTML = svg;
    const scope = own ? outcode : 'London-wide';
    historyNote.textContent = own?.mult15
      ? `${outcode}: ${own.mult15}× since ${d.y0} — ${ordinal(own.rank15)} fastest of ${districts._meta.n_ranked} London districts`
      : `${scope} median since ${d.y0}${d.mult15 ? ` — ${d.mult15}× overall` : ''}`;
    history.hidden = false;
  }

  function showMessage(head, body) {
    title.textContent = head;
    verdict.textContent = body;
    verdict.style.color = '';
    meterDot.parentElement.hidden = true;
    detail.textContent = '';
    price.textContent = '';
    history.hidden = true;
    result.hidden = false;
  }

  closeBtn.addEventListener('click', () => {
    result.hidden = true;
    marker?.remove();
    marker = null;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pc = input.value.trim();
    if (!pc) return;

    let data;
    try {
      const resp = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`,
      );
      if (resp.status === 404) {
        showMessage('Hmm.', `“${pc}” doesn't look like a real UK postcode.`);
        return;
      }
      data = (await resp.json()).result;
    } catch {
      showMessage('No luck.', 'Postcode lookup failed — check your connection and try again.');
      return;
    }

    const { latitude: lat, longitude: lng, admin_district } = data;
    const cell = latLngToCell(lat, lng, RES);
    const p = hexProps.get(cell);

    if (!p) {
      showMessage(
        data.postcode,
        admin_district && !LONDON_BOROUGHS.has(admin_district)
          ? `${admin_district} is outside Greater London — this index stops at the M25 (ish).`
          : 'No index here — fewer than two coffee or chicken shops within a couple of hexes.',
      );
      return;
    }

    const v = verdictFor(p.score);
    title.textContent = `${data.postcode} · ${admin_district ?? ''}`;
    verdict.textContent = `${v.label} — ${p.score > 0 ? '+' : ''}${p.score.toFixed(2)}, more coffee-leaning than ${p.pct}% of London`;
    verdict.style.color = v.color;
    meterDot.parentElement.hidden = false;
    meterDot.style.left = `${((p.score + 1) / 2) * 100}%`;
    detail.textContent = `Nearby: ☕ ${p.cs} coffee shops · 🍗 ${p.fs} chicken shops (smoothed counts)`;
    price.textContent = p.price
      ? `Median sale price around here: ${formatPrice(p.price)} (${p.n} sales, 2023–now)`
      : 'Too few recent sales nearby for a reliable median price.';
    showHistory(data.outcode);
    result.hidden = false;

    marker?.remove();
    marker = new maplibregl.Marker({ color: v.color }).setLngLat([lng, lat]).addTo(map);
    map.flyTo({ center: [lng, lat], zoom: 13.2, duration: 2200 });
  });
}

// districts postcodes.io reports for Greater London postcodes
const LONDON_BOROUGHS = new Set([
  'Barking and Dagenham', 'Barnet', 'Bexley', 'Brent', 'Bromley', 'Camden',
  'City of London', 'Croydon', 'Ealing', 'Enfield', 'Greenwich', 'Hackney',
  'Hammersmith and Fulham', 'Haringey', 'Harrow', 'Havering', 'Hillingdon',
  'Hounslow', 'Islington', 'Kensington and Chelsea', 'Kingston upon Thames',
  'Lambeth', 'Lewisham', 'Merton', 'Newham', 'Redbridge', 'Richmond upon Thames',
  'Southwark', 'Sutton', 'Tower Hamlets', 'Waltham Forest', 'Wandsworth',
  'Westminster',
]);
