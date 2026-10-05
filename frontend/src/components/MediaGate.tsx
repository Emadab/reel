import type { ReactNode } from "react";
import { Navigate } from "react-router";
import type { Kind } from "../api/media";
import { useSettings } from "../api/hooks";
import { MODES } from "../lib/mode";

/** A medium whose flag is off doesn't exist in the UI: its routes go back to the movie library. */
export function MediaGate({ kind, children }: { kind: Kind; children: ReactNode }) {
  const { data } = useSettings();
  if (!data) return null;
  return data.flags?.[MODES[kind].flag!] ? <>{children}</> : <Navigate to="/" replace />;
}
