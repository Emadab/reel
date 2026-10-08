/**
 * The deflect burst, drawn on a canvas: white-hot core, flare, flash, shockwave and sparks. Runs in a worker on an
 * OffscreenCanvas (lib/burst.worker.ts) so nothing on the main thread can stall it; the same code draws on the
 * main thread where workers can't take a canvas.
 */
export type BurstSpec = { x: number; y: number; big: boolean; accent: string; size: number; seed: number };

type Spark = { vx: number; vy: number; T: number; len: number; thick: number; delay: number };
type Burst = BurstSpec & { start: number; hold: number; sparks: Spark[] };

const K = 7; // drag
const G = 1600; // gravity, px/s²
// white-hot to ember, as [r, g, b]
const COOL: [number, number, number][] = [[255, 255, 255], [255, 243, 196], [255, 198, 90], [255, 138, 36], [194, 65, 12]];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function sparks(n: number, delay: number, power: number, rnd: () => number): Spark[] {
  return Array.from({ length: n }, () => {
    // mostly a fan up and out, like steel striking steel; some anywhere
    const a = rnd() < 0.75 ? -Math.PI / 2 + (rnd() - 0.5) * 2.6 : rnd() * Math.PI * 2;
    const v0 = (700 + rnd() * 1500) * power;
    return {
      vx: Math.cos(a) * v0, vy: Math.sin(a) * v0, T: 0.4 + rnd() * 0.45,
      len: 14 + rnd() * 26 * power, thick: rnd() < 0.3 ? 3 : 2, delay: delay + rnd() * 30,
    };
  });
}

export function makeBurst(spec: BurstSpec, now: number): Burst {
  const hold = spec.big ? 130 : 80; // the hit-stop
  const rnd = rng(spec.seed);
  const list = sparks(spec.big ? 70 : 40, hold, spec.big ? 1.3 : 1, rnd);
  if (spec.big) list.push(...sparks(36, hold + 150, 0.8, rnd));
  return { ...spec, start: now, hold, sparks: list };
}

const snap = (p: number) => 1 - Math.pow(1 - Math.min(Math.max(p, 0), 1), 4); // ≈ cubic-bezier(.05,.9,.2,1)
const cool = (p: number) => {
  const f = Math.min(Math.max(p, 0), 0.999) * (COOL.length - 1);
  const i = Math.floor(f);
  const t = f - i;
  const [a, b] = [COOL[i], COOL[i + 1]];
  return `rgb(${a[0] + (b[0] - a[0]) * t | 0},${a[1] + (b[1] - a[1]) * t | 0},${a[2] + (b[2] - a[2]) * t | 0})`;
};

/** Draws every live burst at time `now` (ms). Returns false once they have all played out. */
export function draw(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, bursts: Burst[], now: number, w: number, h: number): boolean {
  ctx.clearRect(0, 0, w, h);
  let alive = false;
  for (const b of bursts) {
    const t = now - b.start;
    const { x, y, hold, big, accent } = b;
    if (t < hold + 1000) alive = true;

    // the frame flashes from the point of contact
    if (t < hold + 120) {
      const o = (big ? 0.55 : 0.38) * (t < (hold + 120) * 0.4 ? 1 : 1 - (t - (hold + 120) * 0.4) / ((hold + 120) * 0.6));
      const r = Math.hypot(w, h) * 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * o})`);
      g.addColorStop(0.3, `rgba(255,236,200,${0.35 * o})`);
      g.addColorStop(1, "rgba(255,236,200,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "lighter";

    // white-hot core, held through the freeze, then gone
    const coreEnd = hold + 220;
    if (t < coreEnd) {
      const c = (big ? 170 : 120) / 2;
      const p = t / coreEnd;
      const hp = hold / coreEnd;
      const s = p < hp ? 0.6 + 0.4 * snap(p / hp) : 1 + 0.5 * snap((p - hp) / (1 - hp));
      const o = p < hp ? 1 : 1 - (p - hp) / (1 - hp);
      const r = c * s;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${o})`);
      g.addColorStop(0.3, `rgba(255,255,255,${o})`);
      g.addColorStop(0.48, `rgba(255,226,160,${o})`);
      g.addColorStop(0.66, `rgba(255,170,60,${0.55 * o})`);
      g.addColorStop(1, "rgba(255,170,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // the flare: a razor line across the point of contact, plus a fainter cross
    const flareEnd = hold + 200;
    if (t < flareEnd) {
      for (const [len, angle, thick, o0] of [[big ? 460 : 300, -14, 4, 1], [big ? 200 : 130, 76, 3, 0.8]]) {
        const p = t / flareEnd;
        const hp = hold / flareEnd;
        const sx = p < hp ? 0.1 + 0.9 * snap(p / hp) : 1 + 0.25 * snap((p - hp) / (1 - hp));
        const sy = p < hp ? 1 : 1 - snap((p - hp) / (1 - hp));
        const o = p < hp ? o0 : o0 * (1 - snap((p - hp) / (1 - hp)));
        const L = len * sx;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((angle * Math.PI) / 180);
        for (const [th, col, a] of [[thick * 10, accent, 0.18], [thick * 4, "#ffb443", 0.35], [thick, "#ffffff", 1]] as const) {
          const g = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
          g.addColorStop(0, "rgba(255,255,255,0)");
          g.addColorStop(0.35, col);
          g.addColorStop(0.65, col);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.globalAlpha = o * a;
          ctx.fillStyle = g;
          ctx.fillRect(-L / 2, (-th * sy) / 2, L, th * sy);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // the shockwave: thin, sharp and fast, after the hold
    for (let i = 0; i < (big ? 2 : 1); i++) {
      const p = (t - hold - i * 90) / 380;
      if (p < 0 || p > 1) continue;
      const r = (b.size / 2) * (0.9 + (big ? 4.1 - i * 1.5 : 2.5) * snap(p));
      const o = 1 - snap(p);
      ctx.lineWidth = 8;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.25 * o;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = o;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // sparks: streaks along their flight, flung hard, dragged to a crawl, pulled down, cooling as they go
    ctx.lineCap = "round";
    for (const s of b.sparks) {
      const tt = (t - s.delay) / 1000;
      if (tt < 0 || tt > s.T) continue;
      const p = tt / s.T;
      const e = Math.exp(-K * tt);
      const px = x + (s.vx / K) * (1 - e);
      const py = y + (s.vy / K) * (1 - e) + (G / K) * tt - (G / (K * K)) * (1 - e);
      const svx = s.vx * e;
      const svy = s.vy * e + (G / K) * (1 - e);
      const speed = Math.hypot(svx, svy) || 1;
      const L = s.len * Math.max(0.12, Math.min(1, speed / 900));
      const tx = px - (svx / speed) * L;
      const ty = py - (svy / speed) * L;
      const o = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      const col = cool(p);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.strokeStyle = "#ffb443"; // the glow: a soft falloff, no hard edge
      for (const [extra, alpha] of [[9, 0.07], [5, 0.12], [2.5, 0.22]]) {
        ctx.globalAlpha = alpha * o;
        ctx.lineWidth = s.thick + extra;
        ctx.stroke();
      }
      ctx.globalAlpha = o;
      ctx.strokeStyle = col;
      ctx.lineWidth = s.thick;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  return alive;
}

/** The loop: runs only while a burst is playing. */
export function runner(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, raf: (cb: (t: number) => void) => void, clock: () => number) {
  let bursts: Burst[] = [];
  let w = 0;
  let h = 0;
  let dpr = 1;
  let running = false;
  const frame = () => {
    const now = clock();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const alive = draw(ctx, bursts, now, w, h);
    bursts = bursts.filter((b) => now - b.start < b.hold + 1000);
    if (alive) raf(frame);
    else {
      ctx.clearRect(0, 0, w, h);
      running = false;
    }
  };
  return {
    size(width: number, height: number, ratio: number) {
      [w, h, dpr] = [width, height, ratio];
      const c = ctx.canvas as { width: number; height: number };
      c.width = Math.round(width * ratio);
      c.height = Math.round(height * ratio);
    },
    fire(spec: BurstSpec) {
      bursts.push(makeBurst(spec, clock()));
      if (!running) {
        running = true;
        frame(); // the first frame now, not a frame later
      }
    },
  };
}
