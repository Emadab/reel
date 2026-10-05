export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDark = (hex: string) => luminance(hex) < 0.08;

/** The lightest swatch: the "palette light" used for ratings on the last-watched card. */
export function lightest(palette: string[], fallback = "#F1E6C8"): string {
  return palette.length ? palette.reduce((a, b) => (luminance(b) > luminance(a) ? b : a)) : fallback;
}

/** Text colour for a solid background (the detail page's glow button). */
export function onColor(bg: string): string {
  const l = luminance(bg);
  return (l + 0.05) / (luminance("#120904") + 0.05) >= 4.5 ? "#120904" : "#FFFFFF";
}
