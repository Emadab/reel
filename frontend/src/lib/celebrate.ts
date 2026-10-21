/**
 * Ticking off an episode lands like a deflected blow: on contact a white-hot flash, a flare across the button
 * and a steel clang; the frame holds for a beat (hit-stop); then incandescent sparks tear out, slow, droop and
 * cool from white to ember, a sharp shockwave cuts outward and the page shakes. `big` (caught up, a season done)
 * is the perfect deflect: longer hold, a second wave of sparks, a heavier shake and a deeper ring. Hitting the
 * same thing again while its combo is open (`strike`) deflects again, each hit with its own steel.
 *
 * Built so it can't stutter:
 * - it fires on the click itself, never after the save (callers update optimistically);
 * - the burst is drawn on a full-window OffscreenCanvas by a worker with its own frame loop (lib/burst.ts), so
 *   nothing the main thread does (React renders, layout, GC) can hold up a frame of it;
 * - what stays on the page (the button's squash and the page shake) animates only transform, on the compositor;
 * - the slow setup happens on pointer-down, in the ~100 ms before the click: the audio engine starts, the canvas
 *   and its worker exist, and the page is promoted to its own layer so the shake doesn't rasterize it on impact;
 * - whatever the click causes (cache updates, refetches) waits for the burst to finish: `whenCalm`.
 * Reduced motion keeps only a small press (and the sound).
 */
import { runner, type BurstSpec } from "./burst";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let audio: AudioContext | null = null;
let scrape: AudioBuffer | null = null;
let hush: ReturnType<typeof setTimeout> | undefined;
let calmAt = 0;
let promoted: HTMLElement | null = null;
let fire: ((spec: BurstSpec) => void) | null = null;
let layer: HTMLCanvasElement | null = null;
let rest: ReturnType<typeof setTimeout> | undefined;

/** The full-window canvas the burst is drawn on, handed to a worker when the browser allows it. */
function canvas(): (spec: BurstSpec) => void {
  if (fire) return fire;
  const c = document.createElement("canvas");
  c.setAttribute("aria-hidden", "true");
  c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;visibility:hidden";
  document.body.appendChild(c); // hidden between bursts, so the compositor isn't blending an empty full-window layer
  layer = c;
  const size = (): [number, number, number] => [window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2)];
  if ("transferControlToOffscreen" in c && typeof Worker !== "undefined") {
    try {
      const off = c.transferControlToOffscreen();
      const worker = new Worker(new URL("./burst.worker.ts", import.meta.url), { type: "module" });
      worker.postMessage({ canvas: off }, [off]);
      worker.postMessage({ size: size() });
      window.addEventListener("resize", () => worker.postMessage({ size: size() }));
      return (fire = (spec) => worker.postMessage({ fire: spec }));
    } catch {
      // fall through to drawing here
    }
  }
  const ctx = c.getContext("2d")!;
  const r = runner(ctx, requestAnimationFrame, () => performance.now());
  r.size(...size());
  window.addEventListener("resize", () => r.size(...size()));
  return (fire = r.fire);
}

/** The audio engine (slow to start: tens of ms) and the scrape's noise. Made while idle; it waits suspended,
 *  costing nothing, until a press resumes it. */
function engine(): AudioContext | null {
  try {
    audio ??= new AudioContext();
    if (!scrape) {
      const len = Math.floor(audio.sampleRate * 0.12);
      scrape = audio.createBuffer(1, len, audio.sampleRate);
      const data = scrape.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return audio;
  } catch {
    return null; // no audio device
  }
}

/** Once it has all rung out, stop the audio thread (a running context burns CPU and battery on silence). */
function quietLater(ac: AudioContext) {
  clearTimeout(hush);
  hush = setTimeout(() => void ac.suspend(), 2500);
}

/** Call on pointer-down of anything that celebrates: wakes the audio and lifts the page onto its own layer in
 *  the ~100 ms before the click lands. */
export function primeCelebrate(ev?: { currentTarget?: EventTarget | null }) {
  void engine()?.resume();
  if (reduced()) return;
  canvas();
  const page = ev?.currentTarget instanceof Element ? (ev.currentTarget.closest("main") as HTMLElement | null) : null;
  if (page && promoted !== page) {
    page.style.willChange = "translate"; // rasterized now, so the shake only moves a layer
    promoted = page;
  }
}

/** Run `fn` once the current burst has played out (right away when none is), when the main thread is idle.
 *  For the work a tick causes: cache updates, refetches. */
export function whenCalm(fn: () => void) {
  const wait = Math.max(0, calmAt - performance.now());
  setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 400 }) : fn()), wait);
}

/** After the next frame is on screen: lets a burst's first frame land before other work starts. */
export function afterFirstFrame(fn: () => void) {
  requestAnimationFrame(() => setTimeout(fn, 0));
}

const COOLDOWN = 180; // ms before the next click on the same thing registers
const WINDOW = 1500; // ms a combo stays open after its last hit
let last: { key: string; at: number; n: number } | null = null;

/** Gate for repeat clicks on one thing (`key`): null while it's cooling down (ignore the click), 1 for a fresh
 *  hit, n > 1 for the nth deflect of a combo still open on it. */
export function strike(key: string, now = performance.now()): number | null {
  if (last?.key === key && now - last.at < COOLDOWN) return null;
  const n = last?.key === key && now - last.at < WINDOW ? last.n + 1 : 1;
  last = { key, at: now, n };
  return n;
}

/** One struck-steel voice: inharmonic partials ringing down over a bright scrape of noise. `drop` starts the
 *  pitch that much sharp and lets it fall (the ting of a parry); `at` delays it (s). */
type Tone = { base: number; ratios: number[]; decay: number; hp: number; scrape: number; drop?: number; at?: number };
// a combo's deflects, in turn: the clang, a parry ting, a heavy deflect, a spike, a double strike
const STRIKES: Tone[][] = [
  [{ base: 520, ratios: [1, 2.76, 5.4, 8.93], decay: 0.7, hp: 3200, scrape: 1 }],
  [{ base: 1250, ratios: [1, 2.4, 4.1], decay: 0.45, hp: 5200, scrape: 0.6, drop: 1.18 }],
  [{ base: 300, ratios: [1, 2.76, 5.4, 8.93, 12.1], decay: 1.3, hp: 1800, scrape: 1.6 }],
  [{ base: 1800, ratios: [1, 3.2], decay: 0.22, hp: 6500, scrape: 2.2, drop: 1.5 }],
  [
    { base: 660, ratios: [1, 2.76, 5.4], decay: 0.5, hp: 3600, scrape: 1 },
    { base: 990, ratios: [1, 2.76, 5.4], decay: 0.6, hp: 4200, scrape: 0.8, at: 0.045 },
  ],
];

/** The steel of the nth hit; a combo climbs a semitone a hit. */
function clang(big: boolean, n = 1) {
  try {
    const ac = engine();
    if (!ac) return;
    void ac.resume();
    const out = ac.createGain();
    out.gain.value = big ? 0.22 : 0.16;
    out.connect(ac.destination);
    const lift = 2 ** (Math.min(n - 1, 7) / 12);
    for (const v of STRIKES[(n - 1) % STRIKES.length]) {
      const t = ac.currentTime + (v.at ?? 0);
      const base = v.base * lift * (big ? 0.73 : 1);
      const decay = v.decay * (big ? 1.57 : 1);
      v.ratios.forEach((ratio, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(base * ratio * (v.drop ?? 1), t);
        if (v.drop) o.frequency.exponentialRampToValueAtTime(base * ratio, t + 0.05);
        g.gain.setValueAtTime(0.6 / (i + 1), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + i * 0.6));
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + decay + 0.2);
      });
      const noise = ac.createBufferSource();
      const hp = ac.createBiquadFilter();
      const ng = ac.createGain();
      hp.type = "highpass";
      hp.frequency.value = v.hp;
      ng.gain.value = v.scrape;
      noise.buffer = scrape;
      noise.connect(hp).connect(ng).connect(out);
      noise.start(t);
    }
    quietLater(ac);
  } catch {
    // no audio device: the sparks still fly
  }
}

// a pentatonic run up from C5, a note per key: a rating never sounds sour
const NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21].map((s) => 523.25 * 2 ** (s / 12));

/** A rating's sound: a bell note that rises with the score, an arpeggio up to it from 7, a shimmer from 9 and
 *  a bloom under a 10. `null` (cleared) is a soft falling blip. */
export function chime(score: number | null) {
  try {
    const ac = engine();
    if (!ac) return;
    void ac.resume();
    const t0 = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = 0.14;
    out.connect(ac.destination);
    const note = (f: number, t: number, len: number, peak = 0.7, type: OscillatorType = "sine", to?: number) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.05);
    };
    if (score == null) note(440, t0, 0.2, 0.5, "sine", 220);
    else {
      const i = Math.min(9, Math.max(0, Math.ceil(score) - 1));
      const run = score >= 10 ? [5, 6, 7, 8, 9] : score >= 9 ? [i - 4, i - 2, i] : score >= 7 ? [i - 2, i] : [i];
      run.forEach((k, j) => {
        const f = NOTES[Math.max(0, k)];
        note(f, t0 + j * 0.06, 0.55);
        note(f * 2, t0 + j * 0.06, 0.3, 0.15, "triangle"); // a little bell on top
      });
      if (score >= 9) [4, 5, 6].forEach((m, j) => note(NOTES[i] * m, t0 + run.length * 0.06 + j * 0.03, 0.8, 0.06));
      if (score >= 10) note(NOTES[0] / 2, t0, 1.2, 0.35);
    }
    quietLater(ac);
  } catch {
    // no audio device
  }
}

const STAR = "#F5D88A"; // --color-star-on

/** A label that pops up off `el` and fades: a combo's ×n, a rating's score. */
function floatLabel(el: Element, text: string, color: string, font = "600 14px var(--font-mono)") {
  const r = el.getBoundingClientRect();
  const s = document.createElement("span");
  s.setAttribute("aria-hidden", "true");
  s.textContent = text;
  s.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top - 4}px;translate:-50% -100%;z-index:10000;pointer-events:none;white-space:nowrap;font:${font};color:${color};text-shadow:0 0 12px ${color}`;
  document.body.appendChild(s);
  s.animate(
    [
      { transform: "translateY(6px) scale(0.6)", opacity: 0 },
      { transform: "translateY(-4px) scale(1.15)", opacity: 1, offset: 0.25 },
      { transform: "translateY(-26px) scale(1)", opacity: 0 },
    ],
    { duration: 700, easing: "cubic-bezier(.2,.8,.3,1)" },
  ).onfinish = () => s.remove();
}

/** Shows the burst canvas for `ms`, then hides it again and gives the page layer back. */
function showLayer(ms: number) {
  layer!.style.visibility = "visible";
  clearTimeout(rest);
  rest = setTimeout(() => {
    layer!.style.visibility = "hidden";
    if (promoted) promoted.style.willChange = "";
    promoted = null;
  }, ms);
}

const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(r.width, r.height) };
};
const seed = () => (Math.random() * 2 ** 32) >>> 0;

/** `n` > 1: the nth deflect of a combo (`strike`): its own steel, a ×n, and from the 4th on the big burst.
 *  `accent` tints the burst; `silent` leaves the sound to the caller. */
export function celebrate(
  el: Element | null | undefined,
  { big = false, n = 1, accent, silent = false }: { big?: boolean; n?: number; accent?: string; silent?: boolean } = {},
) {
  if (!el) return;
  big ||= n >= 4;
  const hold = big ? 130 : 80; // the hit-stop
  if (!silent) clang(big, n);
  if (reduced()) {
    el.animate([{ transform: "scale(1)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }], { duration: 240 });
    return;
  }
  calmAt = performance.now() + hold + 1000;
  const burst = canvas();
  showLayer(hold + 1050);
  burst({ ...centre(el), big, seed: seed(), accent: accent ?? (getComputedStyle(el).getPropertyValue("--color-accent").trim() || "#7FDBFF") });
  if (n > 1) floatLabel(el, `×${n}`, accent ?? "var(--color-accent)");

  // the button takes the blow: crushed on contact, frozen through the hold, then springs back
  const total = hold + 420;
  el.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(0.82)", offset: 0.02 },
      { transform: "scale(0.82)", offset: hold / total },
      { transform: `scale(${big ? 1.22 : 1.14})`, offset: (hold + 110) / total },
      { transform: "scale(0.97)", offset: (hold + 250) / total },
      { transform: "scale(1)" },
    ],
    { duration: total, easing: "linear" },
  );

  // the page takes the impact (`translate` composes with any transform the page has; a promoted layer just moves)
  const page = (el.closest("main") as HTMLElement | null) ?? document.body;
  const m = big ? 7 : 4;
  page.animate(
    [{ translate: "0 0" }, { translate: `${m}px ${-m / 2}px` }, { translate: `${-m}px ${m / 2}px` }, { translate: `${m / 2}px ${m / 3}px` }, { translate: `${-m / 3}px 0` }, { translate: "0 0" }],
    { duration: big ? 300 : 220, delay: hold, easing: "ease-out" },
  );
}

/** A rating landed on key `el` (`v` null: cleared). The chime always plays; then, by score, the score floats up
 *  and the key gets a ring pulse (< 7), a sprinkle of gold sparks (7+), the gold deflect (9+), or the big one
 *  with every key flashing (10). `keys`: stepped from the keyboard, so sound only, no faster than the cooldown. */
export function rated(el: Element | null | undefined, v: number | null, { keys = false } = {}) {
  if (keys && strike("rate") == null) return;
  chime(v);
  if (keys || v == null || !el || reduced()) return;
  floatLabel(el, v === Math.round(v) ? String(v) : v.toFixed(1), STAR, "600 17px var(--font-display)");
  if (v >= 9) {
    celebrate(el, { big: v >= 10, accent: STAR, silent: true });
    if (v >= 10)
      el.parentElement?.querySelectorAll("[data-score] > span").forEach((k, i) =>
        k.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.9) saturate(0.4)" }, { filter: "brightness(1)" }], { duration: 650, delay: 130 + i * 30 }),
      );
  } else if (v >= 7) {
    canvas()({ ...centre(el), big: false, soft: true, accent: STAR, seed: seed() });
    showLayer(1050);
  } else
    (el.firstElementChild ?? el).animate([{ boxShadow: `0 0 0 0 ${STAR}b0` }, { boxShadow: `0 0 0 10px ${STAR}00` }], { duration: 520, easing: "ease-out" });
}

// the canvas and its worker start while the app is idle, so even the first tick has them ready
if (typeof window !== "undefined" && !reduced()) {
  ("requestIdleCallback" in window ? requestIdleCallback : setTimeout)(() => {
    canvas();
    engine();
  });
}
