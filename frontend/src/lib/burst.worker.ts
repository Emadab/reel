/// <reference lib="webworker" />
// The deflect burst's own thread: draws on the page's OffscreenCanvas, so main-thread work can't drop a frame.
import { runner, type BurstSpec } from "./burst";

type Msg = { canvas: OffscreenCanvas } | { size: [number, number, number] } | { fire: BurstSpec };
let r: ReturnType<typeof runner> | null = null;

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if ("canvas" in m) {
    const ctx = m.canvas.getContext("2d");
    if (ctx) r = runner(ctx, (cb) => self.requestAnimationFrame(cb), () => performance.now());
  } else if ("size" in m) r?.size(...m.size);
  else r?.fire(m.fire);
};
