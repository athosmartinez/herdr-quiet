// WCAG contrast helpers, plain JS without Herdr imports so tests can load them.

const DARK = "#18181b";
const LIGHT = "#ffffff";

// Relative luminance of "#rrggbb" (an "#rrggbbaa" alpha is ignored), or null.
export function luminance(hex) {
  const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hex ?? "");
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// The avatar letter: dark or white, whichever reads better on `fill`.
// A user-picked color can be dark, so the letter can't be fixed.
export function letterColor(fill) {
  if (luminance(fill) == null) return DARK;
  return contrast(DARK, fill) >= contrast(LIGHT, fill) ? DARK : LIGHT;
}
