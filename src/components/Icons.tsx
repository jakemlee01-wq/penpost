type P = { className?: string };
const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const ThumbUp = ({ className, filled }: P & { filled?: boolean }) => (
  <svg {...base} className={className} fill={filled ? "currentColor" : "none"}>
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
    <path d="M7 10l4.2-6.3a1.6 1.6 0 0 1 2.9 1.1L13.5 9H19a2 2 0 0 1 2 2.3l-1.2 7.6A2.5 2.5 0 0 1 17.3 21H7" />
  </svg>
);
export const ThumbDown = ({ className, filled }: P & { filled?: boolean }) => (
  <svg {...base} className={className} fill={filled ? "currentColor" : "none"} style={{ transform: "scaleY(-1)" }}>
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
    <path d="M7 10l4.2-6.3a1.6 1.6 0 0 1 2.9 1.1L13.5 9H19a2 2 0 0 1 2 2.3l-1.2 7.6A2.5 2.5 0 0 1 17.3 21H7" />
  </svg>
);
export const ChevronRight = ({ className }: P) => (
  <svg {...base} className={className}><path d="M9 5l7 7-7 7" /></svg>
);
export const ChevronLeft = ({ className }: P) => (
  <svg {...base} className={className}><path d="M15 5l-7 7 7 7" /></svg>
);
export const Menu = ({ className }: P) => (
  <svg {...base} className={className}><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></svg>
);
export const Close = ({ className }: P) => (
  <svg {...base} className={className}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const ExternalLink = ({ className }: P) => (
  <svg {...base} width={14} height={14} className={className}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
