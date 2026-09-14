// WCAG contrast-ratio audit for the OKLCH design tokens in app/globals.css
// (EXPERIENCE-P0-05 — a real computed contrast check, not just a spot-check).
// Run with `node scripts/contrast-check.mjs` after changing any token value
// in app/globals.css to confirm no regression. The token values below are
// hand-kept in sync with globals.css (no CSS parser here) — update both
// together. As of 2026-09-14 all text pairs pass; `border` intentionally
// stays under 3:1 as a decorative card/table divider (WCAG 1.4.11 doesn't
// require it — region boundaries are also carried by background/spacing),
// while `input` (form-field boundaries, a real 1.4.11 case) was raised to
// clear 3:1 in both themes.

function oklchToSrgb(L, C, Hdeg) {
  const H = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toSrgb = (c) => {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return [toSrgb(r), toSrgb(g), toSrgb(bl)];
}

function relLuminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(oklch1, oklch2) {
  const L1 = relLuminance(oklchToSrgb(...oklch1));
  const L2 = relLuminance(oklchToSrgb(...oklch2));
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

const light = {
  background: [0.985, 0.002, 247],
  foreground: [0.145, 0.02, 257],
  card: [1, 0, 0],
  cardForeground: [0.145, 0.02, 257],
  primary: [0.45, 0.18, 264],
  primaryForeground: [0.985, 0, 0],
  secondary: [0.96, 0.005, 247],
  secondaryForeground: [0.145, 0.02, 257],
  muted: [0.97, 0.004, 247],
  mutedForeground: [0.52, 0.02, 257],
  accent: [0.96, 0.015, 264],
  accentForeground: [0.32, 0.1, 264],
  destructive: [0.55, 0.22, 25],
  destructiveForeground: [0.985, 0, 0],
  success: [0.5, 0.14, 155],
  warning: [0.55, 0.15, 70],
  info: [0.55, 0.15, 250],
  border: [0.9, 0.005, 247],
  input: [0.62, 0.008, 247],
};

const dark = {
  background: [0.145, 0.02, 257],
  foreground: [0.95, 0.005, 247],
  card: [0.19, 0.02, 257],
  cardForeground: [0.95, 0.005, 247],
  primary: [0.72, 0.15, 264],
  primaryForeground: [0.145, 0.02, 257],
  secondary: [0.24, 0.02, 257],
  secondaryForeground: [0.95, 0.005, 247],
  muted: [0.24, 0.02, 257],
  mutedForeground: [0.68, 0.02, 257],
  accent: [0.27, 0.04, 264],
  accentForeground: [0.85, 0.06, 264],
  destructive: [0.68, 0.19, 25],
  destructiveForeground: [0.145, 0.02, 257],
  success: [0.72, 0.15, 155],
  warning: [0.75, 0.14, 70],
  info: [0.68, 0.15, 250],
  border: [0.28, 0.02, 257],
  input: [0.5, 0.03, 257],
};

const pairs = [
  ["foreground on background", "foreground", "background"],
  ["mutedForeground on background", "mutedForeground", "background"],
  ["foreground on card", "foreground", "card"],
  ["mutedForeground on card", "mutedForeground", "card"],
  ["primaryForeground on primary", "primaryForeground", "primary"],
  ["secondaryForeground on secondary", "secondaryForeground", "secondary"],
  ["accentForeground on accent", "accentForeground", "accent"],
  ["destructiveForeground on destructive", "destructiveForeground", "destructive"],
  ["primary text on background (links)", "primary", "background"],
  ["success text on background", "success", "background"],
  ["warning text on background", "warning", "background"],
  ["destructive text on background", "destructive", "background"],
  ["info text on background", "info", "background"],
  ["border on background (decorative divider, no 3:1 requirement)", "border", "background"],
  ["input on background (component boundary, 3:1 required)", "input", "background"],
];

function audit(label, tokens) {
  console.log(`\n=== ${label} ===`);
  for (const [desc, fg, bg] of pairs) {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    const isComponentBoundary = desc.includes("3:1 required");
    const isDecorative = desc.includes("no 3:1 requirement");
    const threshold = isComponentBoundary ? 3 : isDecorative ? 0 : 4.5;
    const pass = ratio >= threshold;
    console.log(`${pass ? "PASS" : "FAIL"}  ${ratio.toFixed(2)}:1  (need ${threshold}:1)  ${desc}`);
  }
}

audit("LIGHT MODE", light);
audit("DARK MODE", dark);
