// The two headline correlations, written into the explainer panel from
// summary.json so the copy can never drift from the data behind it.

export function initFindings(summary) {
  const stats = document.getElementById('corr-stats');
  if (!stats) return;

  const a = summary.apprec;
  const p = (v) => (v > 0.01 ? v.toFixed(2) : v.toExponential(0));

  const sc = summary.scale;
  // Nationally the headline correlation is ~0, so leading with "coffee costs
  // more" would be false at this scale. Say what the number actually is.
  if (sc?.rho_dense != null && Math.abs(summary.spearman_rho) < 0.15) {
    stats.innerHTML =
      `<strong>This is a city pattern, not a national one.</strong> Across ` +
      `${summary.city} the link between coffee and price all but vanishes ` +
      `(ρ = ${summary.spearman_rho.toFixed(2)}, ` +
      `${summary.corr_n.toLocaleString()} hexes): the score mostly separates town from ` +
      `countryside, and a village with two cafés and no chicken shop scores the same ` +
      `+1 as Chelsea. On busy high streets it returns ` +
      `(ρ = ${sc.rho_dense.toFixed(2)}, ${sc.n_dense.toLocaleString()} hexes), and inside ` +
      `London alone it reaches 0.39.`;
  } else {
    stats.innerHTML =
      `<strong>Coffee costs more.</strong> Coffee-leaning areas sell higher ` +
      `(ρ = ${summary.spearman_rho.toFixed(2)}, ${summary.corr_n.toLocaleString()} hexes).`;
  }

  // Reuse the node rather than appending: this runs again on every city
  // switch, and stats.after() would stack a fresh paragraph each time.
  let growth = document.getElementById('corr-growth');
  if (a?.rho15 == null) {
    growth?.remove();
    return;
  }
  if (!growth) {
    growth = document.createElement('div');
    growth.id = 'corr-growth';
    stats.after(growth);
  }
  growth.title =
    `Raw correlation with ${a.y0}–now growth is ${a.rho15.toFixed(2)}, but cheap areas ` +
    `multiply faster from a low base. Same story on a ${a.y0_short} baseline: ` +
    `${a.rho10?.toFixed(2)} raw, ${a.partial10 >= 0 ? '+' : ''}${a.partial10?.toFixed(2)} net of price level.`;
  growth.innerHTML =
    `<strong>But it doesn't predict growth.</strong> Net of what an area cost in ` +
    `${a.y0}, the index says nothing about what happened next ` +
    `(ρ = ${a.partial15 >= 0 ? '+' : ''}${a.partial15.toFixed(2)}, p = ${p(a.partial15_p)}).`;
}
