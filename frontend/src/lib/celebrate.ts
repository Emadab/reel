/**
 * Ticking off an episode lands like a deflected blow: on contact a white-hot flash, a flare across the button
 * and a steel clang; the frame holds for a beat (hit-stop); then incandescent sparks tear out, slow, droop and
 * cool from white to ember, a sharp shockwave cuts outward and the page shakes. `big` (caught up, a season done)
 * is the perfect deflect: longer hold, a second wave of sparks, a heavier shake and a deeper ring.
 *
 * Built so it can't stutter:
 * - it fires on the click itself, never after the save (callers update optimistically);
 * - the burst is drawn on a full-window OffscreenCanvas by a worker with its own frame loop (lib/burst.ts), so
 *   nothing the main thread does (React renders, layout, GC) can hold up a frame of it;
 * - what stays on the page (the button's squash and the page shake) animates only transform, on the compositor;
 * - the slow setup happens on pointer-down, in the ~100 ms before the click: the audio engine starts, the canvas
 *   and its worker exist, and the page is promoted to its own layer so the shake doesn't rasterize it on impact;
 * - whatever the click causes (cache updates, refetches) waits for the burst to finish: `whenCalm`.
 * Reduced motion keeps only a small press.
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

/** A struck-steel clang: inharmonic partials ringing down over a bright scrape of noise. */
function clang(big: boolean) {
  try {
    const ac = engine();
    if (!ac) return;
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
    const noise = ac.createBufferSource();
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3200;
    noise.buffer = scrape;
    noise.connect(hp).connect(out);
    noise.start(t);
    // once it has rung out, stop the audio thread (a running context burns CPU and battery on silence)
    clearTimeout(hush);
    hush = setTimeout(() => void ac.suspend(), 2500);
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
  calmAt = performance.now() + hold + 1000;
  const r = el.getBoundingClientRect();
  const burst = canvas();
  layer!.style.visibility = "visible";
  clearTimeout(rest);
  rest = setTimeout(() => {
    layer!.style.visibility = "hidden";
    if (promoted) promoted.style.willChange = ""; // give the page layer's memory back
    promoted = null;
  }, hold + 1050);
  burst({
    x: r.left + r.width / 2, y: r.top + r.height / 2, big, size: Math.max(r.width, r.height), seed: (Math.random() * 2 ** 32) >>> 0,
    accent: getComputedStyle(el).getPropertyValue("--color-accent").trim() || "#7FDBFF",
  });

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

// the canvas and its worker start while the app is idle, so even the first tick has them ready
if (typeof window !== "undefined" && !reduced()) {
  ("requestIdleCallback" in window ? requestIdleCallback : setTimeout)(() => {
    canvas();
    engine();
  });
}
