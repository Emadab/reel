import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useSettings } from "../api/hooks";
import { MODE_ORDER, MODES, type Mode } from "../lib/mode";

/** A mode whose flag is off doesn't exist in the UI: its routes go to the first mode that is on (or Settings). */
export function MediaGate({ kind, children }: { kind: Mode; children: ReactNode }) {
  const { data } = useSettings();
  if (!data) return null;
  if (data.flags?.[MODES[kind].flag]) return <>{children}</>;
  const next = MODE_ORDER.find((m) => data.flags?.[MODES[m].flag]);
  return <Navigate to={next ? MODES[next].base || "/" : "/settings"} replace />;
}
