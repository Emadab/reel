import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import * as THREE from "three";
import type { FilmCard } from "../api/types";
import { rating } from "../lib/format";
import { posterBg } from "./Poster";

/**
 * Library "3D" mode (design extension): a neon corridor. Posters hang on both walls as hologram panels; you glide
 * down the hall with the wheel, a drag or the arrow keys, and the nearest panel snaps into focus.
 */
const MAX = 72;
const STEP = 2.3; // corridor length per film
const AHEAD = 6.2; // the focused poster sits this far in front of the camera
const WALL_X = 2.7;
const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Nav = { z: number; target: number; idle: number; moved: number; px: number; py: number };

const raw = (hex: string) => new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace); // shaders get sRGB values as-is

function artTexture(f: FilmCard): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 384;
  const g = c.getContext("2d")!;
  g.fillStyle = posterBg(f);
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = f.poster_art.fg ?? "#ECEEF3";
  g.font = "600 26px Unbounded, sans-serif";
  const lines: string[] = [];
  for (const w of f.title.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && g.measureText(`${last} ${w}`).width < 220) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  lines.forEach((l, i) => g.fillText(l, 18, 384 - 22 - (lines.length - 1 - i) * 30));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const PANEL_VERT = /* glsl */ `
  varying vec2 vUv; varying float vDepth;
  void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
`;
const PANEL_FRAG = /* glsl */ `
  uniform sampler2D map; uniform vec3 glow; uniform float time; uniform float focus; uniform float seed;
  varying vec2 vUv; varying float vDepth;
  float h(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec2 uv = vUv;
    // a rare glitch: a few horizontal slices jump sideways for a frame or two
    float tick = floor(time * 7.0 + seed * 31.0);
    float glitch = step(0.975, h(tick)) * step(0.55, h(floor(uv.y * 18.0) + tick));
    uv.x += glitch * (h(tick + 3.0) - 0.5) * 0.06;
    float ca = 0.0025 + 0.004 * (1.0 - focus) + glitch * 0.01; // chromatic split, calmer when focused
    vec3 c = vec3(texture2D(map, uv + vec2(ca, 0.0)).r, texture2D(map, uv).g, texture2D(map, uv - vec2(ca, 0.0)).b);
    float scan = 0.9 + 0.1 * sin(uv.y * 820.0 - time * 6.0);
    c *= mix(scan, 1.0, focus * 0.6);
    // hologram tint off-focus, true colour in focus
    c = mix(c * 0.55 + glow * 0.12, c * 1.08, focus);
    // glowing frame
    vec2 e = min(uv, 1.0 - uv);
    float edge = min(e.x, e.y * 0.667);
    float frame = smoothstep(0.016, 0.0, edge) + smoothstep(0.12, 0.0, edge) * 0.18 * focus;
    c += glow * frame * (0.55 + focus * 0.9);
    // the far end of the hall dissolves into the dark
    float fade = 1.0 - smoothstep(12.0, 38.0, vDepth);
    // panels you've passed melt away instead of filling the screen
    float near = smoothstep(3.6, 5.6, vDepth);
    gl_FragColor = vec4(mix(vec3(0.02, 0.024, 0.035), c, fade), near);
  }
`;
const GRID_VERT = /* glsl */ `
  varying vec3 vWorld; varying float vDepth;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
`;
const GRID_FRAG = /* glsl */ `
  uniform vec3 glow; uniform float strength;
  varying vec3 vWorld; varying float vDepth;
  float line(float v, float w) { float d = abs(fract(v) - 0.5); return smoothstep(w, 0.0, 0.5 - d); }
  void main() {
    float g = max(line(vWorld.x * 0.85, 0.035), line(vWorld.z * 0.6, 0.03));
    float center = smoothstep(2.4, 0.0, abs(vWorld.x)) * 0.25; // a soft lane down the middle
    float fade = (1.0 - smoothstep(4.0, 34.0, vDepth));
    float a = (g * 0.8 + center * 0.35) * fade * strength;
    gl_FragColor = vec4(glow * a, a);
  }
`;

function Panel({ film, index, nav, focus, onOpen, onHover }: { film: FilmCard; index: number; nav: React.RefObject<Nav>; focus: number; onOpen: () => void; onHover: (on: boolean) => void }) {
  const side = index % 2 === 0 ? -1 : 1;
  const glowHex = film.palette[0] ?? posterBg(film);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: PANEL_VERT,
        fragmentShader: PANEL_FRAG,
        transparent: true,
        uniforms: { map: { value: artTexture(film) }, glow: { value: raw(glowHex) }, time: { value: 0 }, focus: { value: 0 }, seed: { value: index * 0.37 } },
      }),
    [film, glowHex, index],
  );
  const mesh = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const src = film.poster ?? film.poster_sm;
    if (!src) return;
    let alive = true;
    new THREE.TextureLoader().load(src, (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      if (alive) mat.uniforms.map.value = t;
    });
    return () => {
      alive = false;
    };
  }, [film.poster, film.poster_sm, mat]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const on = index === focus || hover ? 1 : 0;
    const u = mat.uniforms;
    u.focus.value += (on - u.focus.value) * 0.12;
    if (!reduced) u.time.value = clock.elapsedTime;
    // the focused panel swings toward the centre of the hall and lifts a little
    const m = mesh.current!;
    const f = u.focus.value;
    m.rotation.y = -side * (0.62 - f * 0.28);
    m.position.x = side * (WALL_X - f * 0.35);
    m.position.y = 0.35 + f * 0.12;
    m.scale.setScalar(1 + f * 0.06);
  });
  return (
    <mesh
      ref={mesh}
      position={[side * WALL_X, 0.35, -index * STEP - AHEAD]}
      material={mat}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHover(true);
        onHover(true);
      }}
      onPointerOut={() => {
        setHover(false);
        onHover(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if ((nav.current?.moved ?? 0) < 6) onOpen();
      }}
    >
      <planeGeometry args={[2, 3]} />
    </mesh>
  );
}

function Dust({ length, color }: { length: number; color: string }) {
  const geo = useMemo(() => {
    const n = 500;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 9;
      p[i * 3 + 1] = Math.random() * 5.6 - 2.1;
      p[i * 3 + 2] = -Math.random() * (length + 20);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [length]);
  const pts = useRef<THREE.Points>(null);
  useFrame(({ clock }) => {
    if (!reduced && pts.current) pts.current.position.y = Math.sin(clock.elapsedTime / 4) * 0.15; // slow drift
  });
  return (
    <points ref={pts} geometry={geo}>
      <pointsMaterial size={0.035} color={color} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  );
}

function Grid({ y, length, glow, strength }: { y: number; length: number; glow: string; strength: number }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { glow: { value: raw(glow) }, strength: { value: strength } },
      }),
    [glow, strength],
  );
  return (
    <mesh position={[0, y, -length / 2]} rotation={[y < 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0]} material={mat}>
      <planeGeometry args={[12, length + 40]} />
    </mesh>
  );
}

function Rig({ nav, count, onFocus }: { nav: React.RefObject<Nav>; count: number; onFocus: (i: number) => void }) {
  const { camera } = useThree();
  const last = useRef(-1);
  useFrame((_, dt) => {
    const n = nav.current!;
    const end = (count - 1) * STEP;
    n.idle += dt;
    // after a moment of stillness, glide to the nearest poster
    if (n.idle > 0.35) n.target += (Math.round(n.target / STEP) * STEP - n.target) * 0.08;
    n.target = Math.min(end, Math.max(0, n.target));
    n.z += (n.target - n.z) * Math.min(1, dt * 6);
    camera.position.set(n.px * 0.35, 0.55 + n.py * 0.15, -n.z);
    camera.rotation.set(-n.py * 0.03, -n.px * 0.06, 0);
    const i = Math.min(count - 1, Math.max(0, Math.round(n.z / STEP)));
    if (i !== last.current) {
      last.current = i;
      onFocus(i);
    }
  });
  return null;
}

export default function Corridor3D({ films }: { films: FilmCard[] }) {
  const shown = films.slice(0, MAX);
  const nav = useRef<Nav>({ z: 0, target: 0, idle: 1, moved: 0, px: 0, py: 0 });
  const box = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState(0);
  const [overPoster, setOverPoster] = useState(false); // a hand over a poster, grab/grabbing elsewhere
  const [dragging, setDragging] = useState(false);
  const go = useNavigate();
  const accent = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#7FDBFF", []);
  const film = shown[focus];
  const glow = film?.palette[0] ?? (film ? posterBg(film) : accent);
  const length = shown.length * STEP;

  // the wheel drives the corridor (not the page) while the pointer is over it
  useEffect(() => {
    const el = box.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      nav.current.target += e.deltaY * 0.006;
      nav.current.idle = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const step = (d: number) => {
    const n = nav.current;
    n.target = (Math.round(n.target / STEP) + d) * STEP;
    n.idle = 0;
  };

  if (!shown.length) return null;
  return (
    <section
      ref={box}
      tabIndex={0}
      aria-label={`Neon corridor of your films, ${shown.length} posters. Scroll, drag or use the arrow keys to move; Enter opens the film in focus.`}
      className="relative h-[640px] max-[639px]:h-[480px] rounded-[22px] bg-[#05060A] border border-(--line-2) overflow-hidden touch-none select-none outline-none focus-visible:border-[color-mix(in_oklch,var(--color-accent)_60%,transparent)]"
      onKeyDown={(e) => {
        if (["ArrowDown", "ArrowRight", "PageDown"].includes(e.key)) step(1);
        else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) step(-1);
        else if (e.key === "Home") nav.current.target = 0;
        else if (e.key === "End") nav.current.target = length;
        else if (e.key === "Enter" && film) go(`/film/${film.tmdb_id}`);
        else return;
        e.preventDefault();
      }}
      style={{ cursor: dragging ? "grabbing" : overPoster ? "pointer" : "grab" }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        nav.current.moved = 0;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        nav.current.px = ((e.clientX - r.left) / r.width - 0.5) * 2;
        nav.current.py = ((e.clientY - r.top) / r.height - 0.5) * 2;
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        drag.current = { x: e.clientX, y: e.clientY };
        nav.current.moved += Math.abs(dx) + Math.abs(dy);
        nav.current.target -= (dy + dx) * 0.02;
        nav.current.idle = 0;
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerLeave={() => {
        drag.current = null;
        setDragging(false);
        nav.current.px = nav.current.py = 0;
      }}
    >
      {/* the hall takes on the colour of the poster in focus */}
      <div aria-hidden className="absolute inset-0 pointer-events-none transition-[background] duration-700" style={{ background: `radial-gradient(70% 55% at 50% 50%, color-mix(in oklch, ${glow} 24%, transparent), transparent 70%)` }} />
      <Canvas camera={{ position: [0, 0.55, 0], fov: 52, near: 0.1, far: 80 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Grid y={-2.1} length={length} glow={accent} strength={0.55} />
        <Grid y={3.6} length={length} glow={accent} strength={0.16} />
        <Dust length={length} color={accent} />
        {shown.map((f, i) => (
          <Panel key={f.tmdb_id} film={f} index={i} nav={nav} focus={focus} onOpen={() => go(`/film/${f.tmdb_id}`)} onHover={setOverPoster} />
        ))}
        <Rig nav={nav} count={shown.length} onFocus={setFocus} />
      </Canvas>

      {/* HUD */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 opacity-[0.05] bg-[repeating-linear-gradient(0deg,#fff_0_1px,transparent_1px_3px)]" />
        <div className="absolute inset-x-0 bottom-0 h-[150px] bg-linear-to-t from-[rgba(5,6,10,0.92)] to-transparent" />
        {(["left-4 top-4 border-l border-t", "right-4 top-4 border-r border-t", "left-4 bottom-4 border-l border-b", "right-4 bottom-4 border-r border-b"] as const).map((c) => (
          <span key={c} className={`absolute size-5 border-[color-mix(in_oklch,var(--color-accent)_70%,transparent)] ${c}`} />
        ))}
        <span className="absolute left-9 top-[22px] font-mono text-[11px] tracking-[0.18em] text-[color-mix(in_oklch,var(--color-accent)_80%,white)]">
          REEL://CORRIDOR <span className="text-ink-4">— {String(shown.length).padStart(3, "0")} FILMS</span>
        </span>
        {/* progress rail */}
        <span className="absolute right-[22px] top-16 bottom-16 w-px bg-white/10">
          <span
            className="absolute -left-[3px] size-[7px] rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)] transition-[top] duration-300"
            style={{ top: `${shown.length > 1 ? (focus / (shown.length - 1)) * 100 : 0}%` }}
          />
        </span>
        {film && (
          <div key={film.tmdb_id} className="absolute left-9 bottom-8 flex items-end gap-4 palette-in">
            <span className="font-display font-semibold text-[40px] leading-none tabular-nums" style={{ color: glow, textShadow: `0 0 24px ${glow}` }}>
              {String(focus + 1).padStart(2, "0")}
            </span>
            <span className="flex flex-col gap-1 pb-[3px]">
              <span className="font-display font-semibold text-[18px] text-ink-hi max-w-[46ch] truncate">{film.title}</span>
              <span className="font-mono text-[11px] tracking-[0.08em] text-ink-3 uppercase">
                {[film.year, film.director, film.my_rating != null ? `★ ${rating(film.my_rating)}` : null].filter(Boolean).join("  ·  ")}
                <span className="text-ink-4">  ·  ↵ open</span>
              </span>
            </span>
          </div>
        )}
        {films.length > MAX && <span className="absolute right-9 bottom-8 font-mono text-[11px] text-ink-4">showing {MAX} of {films.length}</span>}
      </div>
    </section>
  );
}
