// Inline SVG scatter of hex score vs median price (log y), plus the headline
// correlation numbers, rendered from summary.json.

const W = 300;
const H = 190;
const PAD = { l: 44, r: 8, t: 8, b: 26 };

export function initScatter(summary) {
  const stats = document.getElementById('corr-stats');
  const chart = document.getElementById('corr-chart');

  const a = summary.apprec;
  stats.innerHTML =
    `<strong>Spearman ρ = ${summary.spearman_rho.toFixed(2)}</strong> · ` +
    `Pearson r = ${summary.pearson_log_r.toFixed(2)} (log price) · ` +
    `${summary.corr_n.toLocaleString()} hexes`;

  if (a?.rho15 != null) {
    const growth = document.createElement('div');
    growth.id = 'corr-growth';
    growth.title =
      `Same test on a ${a.y0_short} baseline: ρ = ${a.rho10?.toFixed(2)} raw, ` +
      `${a.partial10 >= 0 ? '+' : ''}${a.partial10?.toFixed(2)} net of price level — same story on both windows.`;
    growth.innerHTML =
      `<strong>Price growth is a different story.</strong> Districts that lean coffee grew ` +
      `<em>slower</em> since ${a.y0} (ρ = ${a.rho15.toFixed(2)}, ${a.n_districts} districts) — but that is ` +
      `mean reversion, not the coffee. Hold the ${a.y0} price level fixed and the index predicts ` +
      `growth not at all (ρ = ${a.partial15 >= 0 ? '+' : ''}${a.partial15.toFixed(2)}, p = ${a.partial15_p > 0.01 ? a.partial15_p.toFixed(2) : a.partial15_p.toExponential(0)}).`;
    stats.after(growth);
  }

  const pts = summary.scatter;
  if (!pts?.length) return;

  const ys = pts.map((p) => p[1]);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xTo = (x) => PAD.l + ((x + 1) / 2) * (W - PAD.l - PAD.r);
  const yTo = (y) =>
    H - PAD.b - ((Math.log(y) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin))) * (H - PAD.t - PAD.b);

  const yTicks = [250_000, 500_000, 1_000_000, 2_000_000, 4_000_000].filter(
    (t) => t >= yMin && t <= yMax,
  );
  const fmt = (t) => (t >= 1_000_000 ? `£${t / 1_000_000}M` : `£${t / 1000}k`);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter plot of index score against median house price">`;
  // gridlines + labels
  for (const t of yTicks) {
    const y = yTo(t);
    svg += `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="#e5decf" stroke-width="1"/>`;
    svg += `<text x="${PAD.l - 5}" y="${y + 3}" text-anchor="end" font-size="9" fill="#8a8577">${fmt(t)}</text>`;
  }
  for (const t of [-1, -0.5, 0, 0.5, 1]) {
    const x = xTo(t);
    svg += `<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${H - PAD.b}" stroke="#e5decf" stroke-width="${t === 0 ? 1.5 : 1}"/>`;
    svg += `<text x="${x}" y="${H - PAD.b + 12}" text-anchor="middle" font-size="9" fill="#8a8577">${t > 0 ? '+' + t : t}</text>`;
  }
  svg += `<text x="${xTo(-1)}" y="${H - 2}" text-anchor="start" font-size="9" fill="#C2410C">🐔 chicken</text>`;
  svg += `<text x="${xTo(1)}" y="${H - 2}" text-anchor="end" font-size="9" fill="#084C61">coffee ☕</text>`;
  for (const [x, y] of pts) {
    svg += `<circle cx="${xTo(x).toFixed(1)}" cy="${yTo(y).toFixed(1)}" r="1.6" fill="#23859C" fill-opacity="0.25"/>`;
  }
  svg += '</svg>';
  chart.innerHTML = svg;
}
