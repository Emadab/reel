import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import * as THREE from "three";
import type { FilmCard } from "../api/types";
import { posterBg } from "./Poster";

const PER_RING = 24;
const RADIUS = 9;
const MAX = 72;
const CAMERA_Z = RADIUS + 17;

function artTexture(f: FilmCard): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 384;
  const g = c.getContext("2d")!;
  g.fillStyle = posterBg(f);
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = f.poster_art.fg ?? "#ECEEF3";
  g.font = "600 26px Unbounded, sans-serif";
  const words = f.title.split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && g.measureText(`${last} ${w}`).width < 220) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  lines.forEach((l, i) => g.fillText(l, 18, 384 - 22 - (lines.length - 1 - i) * 30));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function PosterPlane({ film, position, rotation, onOpen }: { film: FilmCard; position: [number, number, number]; rotation: number; onOpen: () => void }) {
  const [tex, setTex] = useState<THREE.Texture>(() => artTexture(film));
  const [hover, setHover] = useState(false);
  const mesh = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const src = film.poster ?? film.poster_sm;
    if (!src) return;
    let alive = true;
    new THREE.TextureLoader().load(src, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      if (alive) setTex(t);
    });
    return () => {
      alive = false;
    };
  }, [film.poster, film.poster_sm]);
  useFrame(() => {
    const s = mesh.current!.scale;
    const target = hover ? 1.08 : 1;
    s.setScalar(s.x + (target - s.x) * 0.2);
  });
  return (
    <mesh
      ref={mesh}
      position={position}
      rotation={[0, rotation, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <planeGeometry args={[2, 3]} />
      <meshBasicMaterial map={tex} side={THREE.FrontSide} toneMapped={false} />
    </mesh>
  );
}

function Ring({ films, spin, onFront }: { films: FilmCard[]; spin: React.MutableRefObject<{ angle: number; vel: number; dragging: boolean; moved: number }>; onFront: (f: FilmCard) => void }) {
  const group = useRef<THREE.Group>(null);
  const nav = useNavigate();
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const rings = Math.ceil(films.length / PER_RING);
  const front = useRef(-1);
  useFrame((_, dt) => {
    const s = spin.current;
    if (!s.dragging) {
      s.angle += s.vel;
      s.vel *= 0.92;
      if (!reduced) s.angle += dt * 0.06;
    }
    group.current!.rotation.y = s.angle;
    // the poster nearest the camera (+z) tints the fog
    const step = (Math.PI * 2) / PER_RING;
    const idx = ((Math.round(-s.angle / step) % PER_RING) + PER_RING) % PER_RING;
    const ringIdx = Math.floor(rings / 2) * PER_RING + idx;
    const pick = films[ringIdx] ? ringIdx : idx;
    if (pick !== front.current && films[pick]) {
      front.current = pick;
      onFront(films[pick]);
    }
  });
  return (
    <group ref={group}>
      {films.map((f, i) => {
        const ring = Math.floor(i / PER_RING);
        const a = ((i % PER_RING) / PER_RING) * Math.PI * 2;
        const y = ((rings - 1) / 2 - ring) * 3.6;
        return (
          <PosterPlane
            key={f.tmdb_id}
            film={f}
            position={[Math.sin(a) * RADIUS, y, Math.cos(a) * RADIUS]}
            rotation={a}
            onOpen={() => spin.current.moved < 6 && nav(`/film/${f.tmdb_id}`)}
          />
        );
      })}
    </group>
  );
}

function Fog({ color }: { color: string }) {
  const { scene } = useThree();
  useEffect(() => {
    const c = new THREE.Color(color).lerp(new THREE.Color("#07080C"), 0.55);
    scene.fog = new THREE.Fog(c, CAMERA_Z - RADIUS + 1, CAMERA_Z + RADIUS * 0.6); // the front arc is crisp, the sides fade
  }, [color, scene]);
  return null;
}

/** Library "3D carousel" mode (SCREENS: design extension). */
export default function Carousel3D({ films }: { films: FilmCard[] }) {
  const shown = films.slice(0, MAX);
  const spin = useRef({ angle: 0, vel: 0, dragging: false, moved: 0 });
  const last = useRef(0);
  const [front, setFront] = useState<FilmCard | null>(null);
  const glow = front?.palette[0] ?? (front ? posterBg(front) : "#7FDBFF");
  return (
    <section
      aria-label="3D carousel of your films. Drag or scroll to spin; the grid view lists the same films."
      className="relative h-[640px] max-[639px]:h-[480px] rounded-[22px] bg-(--fill-glass) border border-(--line-2) overflow-hidden touch-none select-none cursor-grab active:cursor-grabbing"
      onPointerDown={(e) => {
        spin.current.dragging = true;
        spin.current.moved = 0;
        last.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (!spin.current.dragging) return;
        const dx = e.clientX - last.current;
        last.current = e.clientX;
        spin.current.moved += Math.abs(dx);
        spin.current.angle += dx * 0.005;
        spin.current.vel = dx * 0.005;
      }}
      onPointerUp={() => (spin.current.dragging = false)}
      onPointerLeave={() => (spin.current.dragging = false)}
      onWheel={(e) => (spin.current.vel += e.deltaY * 0.0006)}
    >
      <div aria-hidden className="absolute inset-0 pointer-events-none transition-[background] duration-700" style={{ background: `radial-gradient(60% 50% at 50% 55%, color-mix(in oklch, ${glow} 30%, transparent), transparent)` }} />
      <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Fog color={glow} />
        <Ring films={shown} spin={spin} onFront={setFront} />
      </Canvas>
      {front && (
        <p className="absolute left-5 bottom-4 m-0 font-mono text-[11px] text-ink-4 pointer-events-none">
          {front.title} · drag or scroll to spin{films.length > MAX ? ` · showing ${MAX} of ${films.length}` : ""}
        </p>
      )}
    </section>
  );
}
