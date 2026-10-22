/**
 * Offline SVG badge of the composite SDD score (REQ-W2-012), shaped like the common flat badges so
 * it sits next to CI badges in a README. Deterministic: the same score yields the same bytes.
 */
const color = (score) => (score >= 90 ? '#2e7d32' : score >= 75 ? '#558b2f' : score >= 50 ? '#f9a825' : '#c62828');
/** Approximate Verdana 11px advance, enough to size a short label. */
const textWidth = (text) => Math.round(text.length * 6.6 + 10);
export const renderBadge = (score, label = 'SDD') => {
    const value = `${Math.round(score)}%`;
    const left = textWidth(label);
    const right = textWidth(value);
    const width = left + right;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">
<title>${label}: ${value}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${left}" height="20" fill="#555"/><rect x="${left}" width="${right}" height="20" fill="${color(score)}"/><rect width="${width}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${left / 2}" y="14">${label}</text><text x="${left + right / 2}" y="14">${value}</text>
</g>
</svg>
`;
};
