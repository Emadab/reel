import { useState } from "react";
import { initials } from "../lib/format";
import { cx } from "./ui";

/** A cast photo that falls back to initials if it's missing or fails to load. */
export function CastPhoto({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  const box = "size-[72px] box-content rounded-full border border-(--line-3)";
  return src && !failed ? (
    <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={cx(box, "object-cover bg-(--color-bg-avatar)")} />
  ) : (
    <div className={cx(box, "bg-(--color-bg-avatar) grid place-items-center font-display text-[18px] text-ink-4")}>{initials(name)}</div>
  );
}
