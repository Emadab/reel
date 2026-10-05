// Every icon used in the Reel design. 24-unit viewBox, stroke = currentColor.
// Usage: <IconSearch size={18} />. Pass strokeWidth to override (nav 1.7, cards 1.8, small/bold 2–2.2).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18, rest: SVGProps<SVGSVGElement>) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.7, "aria-hidden": true as const, focusable: false as const, ...rest,
});

export const IconSearch = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const IconLibrary = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><rect x="3" y="3" width="7" height="10" rx="1.5" /><rect x="14" y="3" width="7" height="10" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /><rect x="14" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const IconTimeline = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeLinecap="round"><path d="M3 12h18" /><circle cx="7" cy="12" r="2" /><circle cx="16" cy="12" r="2" /><path d="M7 5v3M16 16v3M12 5v3" /></svg>
);
export const IconStats = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeLinecap="round"><path d="M5 20V11M11 20V5M17 20v-6M3 20h18" /></svg>
);
export const IconForYou = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeLinejoin="round"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" /></svg>
);
export const IconTasteMap = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><circle cx="6" cy="7" r="2" /><circle cx="17" cy="6" r="1.5" /><circle cx="10" cy="16" r="2.5" /><circle cx="18.5" cy="16.5" r="1.5" /></svg>
);
export const IconPlus = ({ size = 16, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2.2, ...r })} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);
export const IconChevronDown = ({ size = 12, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2.2, ...r })}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconChevronLeft = ({ size = 16, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2, ...r })} strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
);
export const IconChevronRight = ({ size = 16, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2, ...r })} strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
);
export const IconPlay = ({ size = 16, ...r }: P) => (
  <svg {...base(size, { stroke: "none", fill: "currentColor", ...r })}><path d="M8 5v14l11-7z" /></svg>
);
export const IconMore = ({ size = 18, ...r }: P) => (
  <svg {...base(size, { stroke: "none", fill: "currentColor", ...r })}><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
);
export const IconBookmark = ({ size = 18, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 1.8, ...r })} strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
);
export const IconThumbUp = ({ size = 18, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 1.8, ...r })} strokeLinejoin="round"><path d="M7 11v9H4v-9zM7 11l4-8c1.7 0 2.8 1.3 2.5 3L13 9h5.5a2 2 0 012 2.3l-1.2 7A2 2 0 0117.3 20H7" /></svg>
);
export const IconNotInterested = ({ size = 18, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 1.8, ...r })} strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>
);
/** Star used by the StarRating input. `fill` is "0%" | "50%" | "100%". */
export const IconStar = ({ size = 26, fill = "0%", id, ...r }: P & { fill?: string; id: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable={false} {...r}>
    <defs><linearGradient id={id}><stop offset={fill} stopColor="currentColor" /><stop offset={fill} stopColor="transparent" /></linearGradient></defs>
    <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill={`url(#${id})`} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);
// Design extensions (not drawn in the mocks; same stroke style)
export const IconSettings = ({ size, ...r }: P) => (
  <svg {...base(size, r)} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
);
export const IconClose = ({ size = 18, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2, ...r })} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconUpload = ({ size = 18, ...r }: P) => (
  <svg {...base(size, r)} strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4" /></svg>
);
