// Inside the desktop window (pywebview injects `window.pywebview`), switch off browser behaviour
// that has no place in an app: the Back/Refresh/Inspect context menu, F5/Ctrl+R reload, print, save page.
type PyWindow = Window & { pywebview?: unknown };

function enable() {
  document.documentElement.dataset.desktop = "1";
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement;
    const editing = t.closest("input, textarea, [contenteditable='true']");
    if (!editing && !window.getSelection()?.toString()) e.preventDefault();
  });
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "F5" || (mod && ["r", "p", "s", "u"].includes(k))) e.preventDefault();
  });
  window.addEventListener("dragstart", (e) => {
    if ((e.target as HTMLElement).closest?.("a, img")) e.preventDefault();
  });
}

export function installDesktopBehaviour() {
  if ((window as PyWindow).pywebview) enable();
  else window.addEventListener("pywebviewready", enable, { once: true });
}
