// Shared plain-English framing for a score, used by the hover card and the
// postcode result card.

// Band colours track RAMP in basemap-style.js but stay darker at the middle:
// these are used as text and marker colours, where the ramp's near-white
// neutral and pale teal would be unreadable.
const BANDS = [
  { min: 0.75, label: 'Peak flat white territory', color: '#084C61' },
  { min: 0.4, label: 'Firmly coffee country', color: '#23859C' },
  { min: 0.1, label: 'Leans coffee', color: '#4FA3B2' },
  { min: -0.1, label: 'Perfectly balanced', color: '#8a8577' },
  { min: -0.4, label: 'Leans fried chicken', color: '#F76707' },
  { min: -0.75, label: 'Firmly chicken country', color: '#C2410C' },
  { min: -Infinity, label: 'Deep in the chicken zone', color: '#C2410C' },
];

export function verdictFor(score) {
  return BANDS.find((b) => score >= b.min);
}

export function formatPrice(p) {
  if (p >= 1_000_000) return `£${(p / 1_000_000).toFixed(2)}M`;
  return `£${Math.round(p / 1000)}k`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
