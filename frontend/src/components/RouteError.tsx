import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button, PageHeader } from "./ui";

const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;
const RELOADED = "reel:reloaded-for-chunk";

/** A page whose code is from an older build (the app was rebuilt while the window stayed open) reloads once to
 * pick up the new one. Anything else shows what went wrong instead of a blank or raw error page. */
export function reloadOnceForNewBuild(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED)) return false;
    sessionStorage.setItem(RELOADED, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : String(err);
  if (STALE.test(message) && reloadOnceForNewBuild()) return null;
  return (
    <main className="flex flex-col gap-6 pt-9 pb-16 px-12 max-[1023px]:px-6 max-[639px]:px-4 min-w-0">
      <PageHeader title="Something went wrong" subline="This page hit an error. Your library is safe." />
      <pre className="m-0 p-5 rounded-[18px] bg-(--fill-glass) border border-(--line-2) font-mono text-[12px] text-ink-3 whitespace-pre-wrap break-words">{message}</pre>
      <div className="flex flex-wrap gap-[10px]">
        <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
        <Link to="/" className="h-11 px-4 grid place-items-center rounded-[12px] border border-(--line-4) text-[14px] text-ink no-underline hover:bg-(--fill-ctl) hover:text-ink-hi">Back to your library</Link>
      </div>
    </main>
  );
}

// a successful load clears the guard, so the next new build can reload again
setTimeout(() => {
  try {
    sessionStorage.removeItem(RELOADED);
  } catch {
    /* storage blocked: the guard just never resets */
  }
}, 10_000);
