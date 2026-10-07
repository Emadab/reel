/**
 * A burst of neon from a button when an episode is ticked off: the button pops, a flash and a shockwave ring
 * leave it, and confetti and four-point sparks fly out and fall. `big` (caught up, a season done) doubles it with
 * a second ring and a longer, wider spray. Plain DOM + Web Animations on a fixed layer, so it outlives a card
 * that re-sorts or leaves the list the moment the tick lands. Reduced motion keeps only a gentle pop.
 */
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const OUT = "cubic-bezier(.15,.8,.25,1)";

export function celebrate(el: Element | null | undefined, { big = false, colors }: { big?: boolean; colors?: string[] } = {}) {
  if (!el) return;
  el.animate(
    [{ transform: "scale(1)" }, { transform: `scale(${big ? 1.45 : 1.3})`, offset: 0.25 }, { transform: "scale(0.92)", offset: 0.55 }, { transform: "scale(1)" }],
    { duration: 520, easing: "ease-out" },
  );
  if (reduced()) return;

  const css = getComputedStyle(el);
  const accent = css.getPropertyValue("--color-accent").trim() || "#7FDBFF";
  const wild = css.getPropertyValue("--color-wild").trim() || "#F0B6DA";
  const palette = [accent, wild, "#ffffff", accent, ...(colors ?? [])];
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0;pointer-events:none;z-index:9999`;
  document.body.appendChild(layer);
  const add = (style: string) => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:0;top:0;${style}`;
    layer.appendChild(d);
    return d;
  };
  const runs: Animation[] = [];

  // flash: a soft bloom of the accent behind the button
  const f = big ? 220 : 130;
  runs.push(add(`width:${f}px;height:${f}px;margin:${-f / 2}px;border-radius:50%;background:radial-gradient(closest-side,${accent},transparent);mix-blend-mode:screen`)
    .animate([{ opacity: 0.9, transform: "scale(0.3)" }, { opacity: 0, transform: "scale(1.4)" }], { duration: big ? 900 : 600, easing: "ease-out" }));

  // shockwave rings
  for (let i = 0; i < (big ? 2 : 1); i++) {
    const s = Math.max(r.width, r.height) + 8;
    runs.push(add(`width:${s}px;height:${s}px;margin:${-s / 2}px;border-radius:50%;border:${big ? 3 : 2}px solid ${i ? wild : accent};box-shadow:0 0 18px ${i ? wild : accent}`)
      .animate([{ opacity: 1, transform: "scale(0.6)" }, { opacity: 0, transform: `scale(${big ? 4.2 - i : 3})` }], { duration: big ? 900 : 650, delay: i * 140, easing: OUT, fill: "backwards" }));
  }

  // confetti and sparks: out fast, then gravity
  const n = big ? 56 : 26;
  for (let i = 0; i < n; i++) {
    const color = palette[i % palette.length];
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const dist = (big ? 110 : 60) + Math.random() * (big ? 170 : 80);
    const dx = Math.cos(a) * dist;
    const dy = Math.sin(a) * dist - (big ? 40 : 20);
    const fall = (big ? 120 : 70) + Math.random() * 60;
    const spin = (Math.random() - 0.5) * 900;
    const spark = i % 5 === 0;
    const w = spark ? 10 : 4 + Math.random() * 4;
    const h = spark ? 10 : Math.random() < 0.5 ? w : w * 2.2;
    const shape = spark
      ? `clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);background:${color};filter:drop-shadow(0 0 4px ${color})`
      : `border-radius:${Math.random() < 0.4 ? "50%" : "1.5px"};background:${color};box-shadow:0 0 6px ${color}`;
    const dur = (big ? 1300 : 900) + Math.random() * 400;
    runs.push(add(`width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;${shape}`).animate(
      [
        { transform: "translate(0,0) rotate(0) scale(0.4)", opacity: 1, easing: OUT },
        { transform: `translate(${dx}px,${dy}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.35, easing: "cubic-bezier(.45,0,.9,.7)" },
        { transform: `translate(${dx * 1.15}px,${dy + fall}px) rotate(${spin}deg) scale(0.6)`, opacity: 0 },
      ],
      { duration: dur, delay: Math.random() * (big ? 120 : 40), fill: "backwards" },
    ));
  }

  void Promise.allSettled(runs.map((a) => a.finished)).then(() => layer.remove());
}
