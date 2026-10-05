// The previous in-app page, so the detail page's back pill can say where it goes.
const LABELS: [RegExp, string][] = [
  [/^\/$/, "Library"],
  [/^\/timeline/, "Timeline"],
  [/^\/stats/, "Stats"],
  [/^\/for-you/, "For you"],
  [/^\/map/, "Taste map"],
  [/^\/film\//, "Back"],
  [/^\/settings/, "Settings"],
  [/^\/import/, "Import"],
  [/^\/shows$/, "Shows"],
  [/^\/books$/, "Books"],
  [/^\/games$/, "Games"],
];

let previous: string | null = null;
let current: string | null = null;

export function trackPath(path: string) {
  if (path === current) return;
  previous = current;
  current = path;
}

/** Pages render before the shell records their path, so `here` tells us which slot holds the previous page. */
export function backTarget(here: string): { label: string; back: boolean } {
  const prev = current === here ? previous : current;
  if (!prev) return { label: "Library", back: false };
  const label = LABELS.find(([re]) => re.test(prev))?.[1] ?? "Back";
  return { label, back: true };
}
