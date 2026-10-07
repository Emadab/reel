/**
 * Ticking off an episode lands like a deflected blow: on contact a white-hot flash, a flare across the button
 * and a steel clang; the frame holds for a beat (hit-stop); then incandescent sparks tear out, slow, droop and
 * cool from white through gold to ember, a sharp shockwave cuts outward and the page shakes. `big` (caught up,
 * a season done) is the perfect deflect: longer hold, a second wave of sparks, a heavier shake and a deeper
 * ring. Plain DOM + Web Animations on a fixed layer, so it outlives a card that re-sorts or leaves the list the
 * moment the tick lands. Reduced motion keeps only a small press.
 */
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SNAP = "cubic-bezier(.05,.9,.2,1)";
const COOL = ["#ffffff", "#fff3c4", "#ffc65a", "#ff8a24", "#c2410c"]; // white-hot to ember

let audio: AudioContext | null = null;

/** A struck-steel clang: inharmonic partials ringing down over a bright scrape of noise. */
function clang(big: boolean) {
  try {
    audio ??= new AudioContext();
    const ac = audio;
    void ac.resume();
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = big ? 0.22 : 0.16;
    out.connect(ac.destination);
    const base = big ? 380 : 520;
    [1, 2.76, 5.4, 8.93].forEach((ratio, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = base * ratio;
      g.gain.setValueAtTime(0.6 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 1.1 : 0.7) / (1 + i * 0.6));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.2);
    });
    const len = Math.floor(ac.sampleRate * 0.12);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const noise = ac.createBufferSource();
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3200;
    noise.buffer = buf;
    noise.connect(hp).connect(out);
    noise.start(t);
  } catch {
    // no audio device: the sparks still fly
  }
}

export function celebrate(el: Element | null | undefined, { big = false }: { big?: boolean } = {}) {
  if (!el) return;
  const hold = big ? 130 : 80; // the hit-stop
  if (reduced()) {
    el.animate([{ transform: "scale(1)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }], { duration: 240 });
    return;
  }
  clang(big);

  const accent = getComputedStyle(el).getPropertyValue("--color-accent").trim() || "#7FDBFF";
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const runs: Animation[] = [];

  // the button takes the blow: crushed on contact, frozen through the hold, then springs back
  const total = hold + 420;
  el.animate(
    [
      { transform: "scale(1)", filter: "brightness(1)" },
      { transform: "scale(0.82)", filter: "brightness(2.4)", offset: 0.02 },
      { transform: "scale(0.82)", filter: "brightness(2.4)", offset: hold / total },
      { transform: `scale(${big ? 1.22 : 1.14})`, filter: "brightness(1.4)", offset: (hold + 110) / total },
      { transform: "scale(0.97)", filter: "brightness(1)", offset: (hold + 250) / total },
      { transform: "scale(1)", filter: "brightness(1)" },
    ],
    { duration: total, easing: "linear" },
  );

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0;pointer-events:none;z-index:9999`;
  document.body.appendChild(layer);
  const add = (style: string) => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:0;top:0;${style};opacity:0`; // seen only while its animation runs
    layer.appendChild(d);
    return d;
  };

  // the whole frame blinks white on contact
  const blink = document.createElement("div");
  blink.setAttribute("aria-hidden", "true");
  blink.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9998;background:#fff;mix-blend-mode:overlay;opacity:0";
  document.body.appendChild(blink);
  runs.push(blink.animate([{ opacity: big ? 0.5 : 0.32 }, { opacity: big ? 0.5 : 0.32, offset: 0.4 }, { opacity: 0 }], { duration: hold + 120 }));

  // white-hot core, held through the freeze, then gone
  const c = big ? 170 : 120;
  runs.push(add(`width:${c}px;height:${c}px;margin:${-c / 2}px;border-radius:50%;background:radial-gradient(closest-side,#fff 0,#fff 30%,#ffe2a0 48%,rgba(255,170,60,0.55) 66%,transparent)`).animate(
    [{ transform: "scale(0.6)", opacity: 1 }, { transform: "scale(1)", opacity: 1, offset: hold / (hold + 220) }, { transform: "scale(1.5)", opacity: 0 }],
    { duration: hold + 220, easing: "ease-out" },
  ));

  // the flare: a razor line across the point of contact, plus a fainter cross
  const flare = (len: number, angle: number, thick: number, o: number) =>
    runs.push(add(`width:${len}px;height:${thick}px;margin:${-thick / 2}px 0 0 ${-len / 2}px;border-radius:${thick}px;background:linear-gradient(90deg,transparent,#fff 35%,#fff 65%,transparent);box-shadow:0 0 8px #fff,0 0 18px ${accent},0 0 40px #ffb443`).animate(
      [
        { transform: `rotate(${angle}deg) scaleX(0.1) scaleY(1)`, opacity: o },
        { transform: `rotate(${angle}deg) scaleX(1) scaleY(1)`, opacity: o, offset: hold / (hold + 200) },
        { transform: `rotate(${angle}deg) scaleX(1.25) scaleY(0)`, opacity: 0 },
      ],
      { duration: hold + 200, easing: SNAP },
    ));
  flare(big ? 460 : 300, -14, 4, 1);
  flare(big ? 200 : 130, 76, 3, 0.8);

  // the shockwave: thin, sharp and fast, after the hold
  for (let i = 0; i < (big ? 2 : 1); i++) {
    const s = Math.max(r.width, r.height);
    runs.push(add(`width:${s}px;height:${s}px;margin:${-s / 2}px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 10px ${accent},inset 0 0 10px ${accent}`).animate(
      [{ transform: "scale(0.9)", opacity: 1 }, { transform: `scale(${big ? 5 - i * 1.5 : 3.4})`, opacity: 0 }],
      { duration: 380, delay: hold + i * 90, easing: SNAP, fill: "backwards" },
    ));
  }

  // sparks: streaks along their flight, flung hard, dragged to a crawl, pulled down, cooling as they go
  const wave = (n: number, delay: number, power: number) => {
    for (let i = 0; i < n; i++) {
      // mostly a fan up and out, like steel striking steel; some anywhere
      const a = Math.random() < 0.75 ? -Math.PI / 2 + (Math.random() - 0.5) * 2.6 : Math.random() * Math.PI * 2;
      const v0 = (700 + Math.random() * 1500) * power;
      const vx = Math.cos(a) * v0;
      const vy = Math.sin(a) * v0;
      const k = 7; // drag
      const g = 1600; // gravity, px/s²
      const T = 0.4 + Math.random() * 0.45;
      const len = 14 + Math.random() * 26 * power;
      const thick = Math.random() < 0.3 ? 3 : 2;
      const frames: Keyframe[] = [];
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const t = (s / steps) * T;
        const e = Math.exp(-k * t);
        const px = (vx / k) * (1 - e);
        const py = (vy / k) * (1 - e) + (g / k) * t - (g / (k * k)) * (1 - e);
        const svx = vx * e;
        const svy = vy * e + (g / k) * (1 - e);
        const speed = Math.hypot(svx, svy);
        const p = s / steps;
        frames.push({
          transform: `translate(${px}px,${py}px) rotate(${Math.atan2(svy, svx)}rad) scaleX(${Math.max(0.12, Math.min(1, speed / 900))})`,
          backgroundColor: COOL[Math.min(COOL.length - 1, Math.floor(p * COOL.length))],
          opacity: p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3,
        });
      }
      runs.push(add(`width:${len}px;height:${thick}px;margin:${-thick / 2}px 0 0 ${-len}px;transform-origin:100% 50%;border-radius:${thick}px;box-shadow:0 0 6px #ffb443,0 0 2px #fff`).animate(
        frames,
        { duration: T * 1000, delay: delay + Math.random() * 30, easing: "linear" }, // unseen until the hold breaks
      ));
    }
  };
  wave(big ? 70 : 40, hold, big ? 1.3 : 1);
  if (big) wave(36, hold + 150, 0.8);

  // the page takes the impact
  const page = el.closest("main") ?? document.body;
  const m = big ? 7 : 4;
  page.animate(
    [{ translate: "0 0" }, { translate: `${m}px ${-m / 2}px` }, { translate: `${-m}px ${m / 2}px` }, { translate: `${m / 2}px ${m / 3}px` }, { translate: `${-m / 3}px 0` }, { translate: "0 0" }],
    { duration: big ? 300 : 220, delay: hold, easing: "ease-out" },
  );

  void Promise.allSettled(runs.map((a) => a.finished)).then(() => {
    layer.remove();
    blink.remove();
  });
}
