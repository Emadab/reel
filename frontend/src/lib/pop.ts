/**
 * The answer buttons' feedback (save, like, seen, hide), the same in every medium. Each fires on the click itself
 * (callers update optimistically) and is shaped like what it means: a bookmark drops in and fills, a thumb kicks
 * up, a check stamps down, "not interested" shakes its head. Saving, liking and rating also throw a ring and a
 * few sparks in the accent. Everything animates transform and opacity only, on the compositor, and the sparks
 * live in a fixed layer on <body> so no card's overflow clips them. Reduced motion keeps only a small press.
 */
export type Pop = "save" | "like" | "seen" | "hide" | "undo";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const spring = "cubic-bezier(.2,1.6,.4,1)"; // overshoots, then settles

const ICON: Record<Pop, Keyframe[]> = {
  save: [
    { transform: "translateY(-10px) scale(.5)", opacity: 0.2 },
    { transform: "translateY(2px) scale(1.25,.8)", opacity: 1, offset: 0.45 },
    { transform: "translateY(-1px) scale(.95,1.08)", offset: 0.7 },
    { transform: "none" },
  ],
  like: [
    { transform: "none" },
    { transform: "translateY(-5px) rotate(-24deg) scale(1.45)", offset: 0.4 },
    { transform: "rotate(6deg) scale(.95)", offset: 0.75 },
    { transform: "none" },
  ],
  seen: [
    { transform: "scale(.2) rotate(-30deg)", opacity: 0 },
    { transform: "scale(1.4) rotate(6deg)", opacity: 1, offset: 0.5 },
    { transform: "none" },
  ],
  hide: [
    { transform: "none" },
    { transform: "rotate(-30deg)", offset: 0.25 },
    { transform: "rotate(22deg)", offset: 0.5 },
    { transform: "rotate(-10deg)", offset: 0.75 },
    { transform: "none" },
  ],
  undo: [{ transform: "none" }, { transform: "scale(.7)", offset: 0.4 }, { transform: "none" }],
};

const BUTTON: Record<Pop, Keyframe[]> = {
  save: [{ transform: "scale(.88)" }, { transform: "scale(1.08)", offset: 0.45 }, { transform: "none" }],
  like: [{ transform: "scale(.88)" }, { transform: "scale(1.1)", offset: 0.45 }, { transform: "none" }],
  seen: [{ transform: "scale(.88)" }, { transform: "scale(1.08)", offset: 0.45 }, { transform: "none" }],
  hide: [{ transform: "none" }, { transform: "translateX(-4px)", offset: 0.2 }, { transform: "translateX(4px)", offset: 0.45 }, { transform: "translateX(-2px)", offset: 0.7 }, { transform: "none" }],
  undo: [{ transform: "scale(.94)" }, { transform: "none" }],
};

/** A ring off the button's edge and sparks flung out of its centre, in a fixed layer above everything. */
function burst(el: Element, color: string, n: number) {
  // the button's own size around its centre (it's mid-press, so its box is scaled down right now)
  const b = el.getBoundingClientRect();
  const w = (el as HTMLElement).offsetWidth || b.width;
  const h = (el as HTMLElement).offsetHeight || b.height;
  const radius = getComputedStyle(el).borderRadius;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${b.left + b.width / 2 - w / 2}px;top:${b.top + b.height / 2 - h / 2}px;width:${w}px;height:${h}px;pointer-events:none;z-index:150`;
  const ring = document.createElement("span");
  ring.style.cssText = `position:absolute;inset:0;border-radius:${radius};border:2px solid ${color};box-shadow:0 0 14px ${color}`;
  layer.appendChild(ring);
  const anims = [ring.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: `scale(${(w + 36) / w},${(h + 36) / h})`, opacity: 0 }], { duration: 420, easing: "cubic-bezier(.1,.8,.3,1)" })];
  const reach = Math.max(w, h) * 0.5 + 34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const d = reach * (0.75 + Math.random() * 0.45);
    const s = document.createElement("span");
    const size = 4 + Math.random() * 4;
    s.style.cssText = `position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;margin:${-size / 2}px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color}`;
    layer.appendChild(s);
    anims.push(s.animate(
      [
        { transform: "translate(0,0) scale(1.6)", opacity: 1 },
        { transform: `translate(${Math.cos(a) * d * 0.8}px,${Math.sin(a) * d * 0.8}px) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 6}px) scale(0)`, opacity: 0 },
      ],
      { duration: 460 + Math.random() * 180, easing: "cubic-bezier(.1,.7,.3,1)" },
    ));
  }
  document.body.appendChild(layer);
  void Promise.all(anims.map((x) => x.finished)).finally(() => layer.remove());
}

export function pop(el: Element | null | undefined, kind: Pop) {
  if (!el) return;
  if (reduced()) {
    el.animate([{ transform: "scale(.94)" }, { transform: "none" }], { duration: 160 });
    return;
  }
  const big = kind === "save" || kind === "like" || kind === "seen";
  el.animate(BUTTON[kind], { duration: kind === "hide" ? 360 : 300, easing: kind === "hide" ? "ease-out" : spring });
  el.querySelector("svg")?.animate(ICON[kind], { duration: kind === "hide" ? 420 : 460, easing: kind === "hide" ? "ease-out" : spring });
  if (big) burst(el, getComputedStyle(el).getPropertyValue("--color-accent").trim() || "#7FDBFF", kind === "like" ? 7 : 9);
}
