// Postcode lookup: postcodes.io (free, CORS-friendly) -> h3 cell -> hex props.
import maplibregl from 'maplibre-gl';
import { latLngToCell } from 'h3-js';
import { verdictFor, formatPrice, ordinal } from './verdict.js';
import { sparkline } from './sparkline.js';
import { insideBanana } from './banana.js';

const RES = 9;

/** Plain-English reading of the value score (coffee standing minus price standing). */
function valueVerdict(v) {
  if (v >= 0.45) return 'a lot of coffee for the money';
  if (v >= 0.2) return 'decent value for its coffee scene';
  if (v > -0.2) return 'about what you would expect for the price';
  if (v > -0.45) return 'paying a premium over the local coffee scene';
  return 'you are paying for something other than the coffee';
}

// `ctx` is mutated in place when the city changes, so the handlers below always
// read the live city rather than whatever was current when they were bound.
export function initSearch(map, ctx, onTakeOver = () => {}) {
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
  const banana = document.getElementById('result-banana');
  const bananaNote = document.getElementById('result-banana-note');

  let marker = null;

  /** Clear any Banana verdict so it never survives into the next result. */
  function resetBanana() {
    banana.hidden = true;
    bananaNote.hidden = true;
    bananaNote.textContent = '';
    bananaNote.classList.remove('inside');
  }

  /**
   * The Banana verdict, gated exactly as requested: only when the Banana layer
   * is switched on. The toggle is hidden and force-unchecked outside London,
   * so the gate is city-safe for free. Read at search time — flipping the
   * toggle afterwards applies to the next search.
   */
  function showBananaVerdict(lng, lat) {
    resetBanana();
    if (!document.getElementById('toggle-banana')?.checked) return;
    if (!ctx.bananaRing) return;
    // The freehand source stroke is ~1-2 km wide, so this is an indicative
    // call, not a survey — the copy claims no more than in/out.
    if (insideBanana(lng, lat, ctx.bananaRing)) {
      banana.hidden = false;
      bananaNote.textContent = 'Inside the London Banana';
      bananaNote.classList.add('inside');
    } else {
      bananaNote.textContent = 'Outside the London Banana';
    }
    bananaNote.hidden = false;
  }

  /** Draw the district's price history, falling back to the city-wide series. */
  function showHistory(outcode) {
    const { districts, cityName } = ctx;
    const own = districts?.[outcode];
    const d = own ?? districts?._city;
    const svg = d ? sparkline(d.m, d.y0) : '';
    if (!svg) {
      history.hidden = true;
      return;
    }
    spark.innerHTML = svg;
    const scope = own ? outcode : `${cityName}-wide`;
    historyNote.textContent = own?.mult15
      ? `${outcode}: ${own.mult15}× since ${d.y0} — ${ordinal(own.rank15)} fastest of ${districts._meta.n_ranked} ${cityName} districts`
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
    resetBanana();
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
    const p = ctx.hexProps.get(cell);

    if (!p) {
      showMessage(
        data.postcode,
        admin_district
          ? `${admin_district} is outside ${ctx.cityName}. This map covers London, Manchester and Liverpool — try the city switcher.`
          : 'No index here — fewer than two coffee or chicken shops within a couple of hexes.',
      );
      return;
    }

    const v = verdictFor(p.score);
    title.textContent = `${data.postcode} · ${admin_district ?? ''}`;
    // "Nth percentile" rather than "more coffee-leaning than N%": a large block
    // ties at the maximum score, so a strict "more than" claim would overstate
    // what the shared rank actually means.
    verdict.textContent = `${v.label} — ${p.score > 0 ? '+' : ''}${p.score.toFixed(2)}, ${ordinal(p.pct)} percentile ${ctx.cityName}-wide`;
    verdict.style.color = v.color;
    meterDot.parentElement.hidden = false;
    meterDot.style.left = `${((p.score + 1) / 2) * 100}%`;
    detail.textContent = `Nearby: ☕ ${p.cs} coffee shops · 🐔 ${p.fs} chicken shops (smoothed counts)`;
    price.textContent = p.price
      ? `Median sale price around here: ${formatPrice(p.price)} (${p.n} sales, 2023–now)`
      : 'Too few recent sales nearby for a reliable median price.';
    if (p.value != null) {
      price.textContent += ` · ${valueVerdict(p.value)}`;
    }
    showHistory(data.outcode);
    showBananaVerdict(lng, lat);
    result.hidden = false;

    marker?.remove();
    marker = new maplibregl.Marker({ color: v.color }).setLngLat([lng, lat]).addTo(map);
    onTakeOver();
    map.flyTo({ center: [lng, lat], zoom: 13.2, duration: 2200 });
  });
}
