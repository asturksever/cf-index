// Tiny inline-SVG sparkline for a district's annual median price series.
// Years with too few sales arrive as null and are drawn as gaps, not zeros.

const W = 240;
const H = 48;
const PAD = { t: 6, b: 12, l: 2, r: 2 };

/**
 * @param {(number|null)[]} medians one value per year from y0
 * @param {number} y0 first year in the series
 * @returns {string} SVG markup, or '' if there is nothing plottable
 */
export function sparkline(medians, y0) {
  const known = medians.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (known.length < 2) return '';

  const vals = known.map(([, v]) => v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const xTo = (i) => PAD.l + (i / (medians.length - 1)) * (W - PAD.l - PAD.r);
  const yTo = (v) => H - PAD.b - ((v - lo) / span) * (H - PAD.t - PAD.b);

  // split into runs of consecutive known years so gaps stay gaps
  const runs = [];
  let run = [];
  for (const [i, v] of known) {
    if (run.length && i !== run.at(-1)[0] + 1) {
      runs.push(run);
      run = [];
    }
    run.push([i, v]);
  }
  runs.push(run);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Median price by year since ${y0}">`;
  for (const r of runs) {
    if (r.length < 2) continue;
    const pts = r.map(([i, v]) => `${xTo(i).toFixed(1)},${yTo(v).toFixed(1)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="#084C61" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const [lastI, lastV] = known.at(-1);
  svg += `<circle cx="${xTo(lastI).toFixed(1)}" cy="${yTo(lastV).toFixed(1)}" r="2.8" fill="#084C61"/>`;
  svg += `<text x="${PAD.l}" y="${H - 2}" font-size="9" fill="#8a8577">${y0}</text>`;
  svg += `<text x="${W - PAD.r}" y="${H - 2}" text-anchor="end" font-size="9" fill="#8a8577">${y0 + lastI}</text>`;
  svg += '</svg>';
  return svg;
}
