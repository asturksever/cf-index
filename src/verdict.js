// Shared plain-English framing for a score, used by the hover card and the
// postcode result card.

const BANDS = [
  { min: 0.75, label: 'Peak flat white territory', color: '#0B7285' },
  { min: 0.4, label: 'Firmly coffee country', color: '#0B7285' },
  { min: 0.1, label: 'Leans coffee', color: '#66A5AD' },
  { min: -0.1, label: 'Perfectly balanced', color: '#8a8577' },
  { min: -0.4, label: 'Leans fried chicken', color: '#F4A261' },
  { min: -0.75, label: 'Firmly chicken country', color: '#E8590C' },
  { min: -Infinity, label: 'Deep in the chicken zone', color: '#E8590C' },
];

export function verdictFor(score) {
  return BANDS.find((b) => score >= b.min);
}

export function formatPrice(p) {
  if (p >= 1_000_000) return `£${(p / 1_000_000).toFixed(2)}M`;
  return `£${Math.round(p / 1000)}k`;
}
