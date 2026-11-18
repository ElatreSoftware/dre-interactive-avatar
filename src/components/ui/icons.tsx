/** Inline 24px icons, so the widget pulls in no icon dependency. */
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const MicIcon = () => (
  <svg {...base}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
  </svg>
);

export const MicOffIcon = () => (
  <svg {...base}>
    <path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 10V5a3 3 0 0 0-5.9-.8" />
    <path d="M19 10v2a7 7 0 0 1-10.8 5.9M5 10v2a7 7 0 0 0 7 7v3" />
  </svg>
);

export const StopIcon = () => (
  <svg {...base}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const PhoneOffIcon = () => (
  <svg {...base}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
    <path d="m2 2 20 20" />
  </svg>
);

export const ChatIcon = () => (
  <svg {...base} width={24} height={24}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 4 12a8.4 8.4 0 0 1 8.5-8.5 8.4 8.4 0 0 1 8.5 8Z" />
  </svg>
);

export const VideoIcon = () => (
  <svg {...base} width={22} height={22}>
    <path d="m22 8-6 4 6 4V8Z" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </svg>
);

/** Captions on a screen — the conventional subtitles mark. */
export const SubtitlesIcon = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M7 14h4M14 14h3" />
    <path d="M7 10.5h2M12 10.5h5" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const SendIcon = () => (
  <svg {...base}>
    <path d="m22 2-7 20-4-9-9-4Z" />
  </svg>
);
