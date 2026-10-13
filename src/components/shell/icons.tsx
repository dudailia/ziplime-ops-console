// Small stroke icons for the rail and the phone bar.
const base = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;

export const IconReview = () => (
  <svg {...base}>
    <path d="M2 4h14M2 9h14M2 14h14" strokeOpacity={0.35} />
    <path d="M5 2.5v3M9 7.5v3M13 12.5v3" />
  </svg>
);
export const IconAccounts = () => (
  <svg {...base}>
    <rect x="2.5" y="3" width="13" height="12" rx="1" />
    <path d="M2.5 7h13M6.5 7v8" />
  </svg>
);
export const IconIntake = () => (
  <svg {...base}>
    <path d="M2.5 10.5h3.5l1 2h4l1-2h3.5" />
    <path d="M2.5 10.5 4.5 3.5h9l2 7v4h-13z" />
  </svg>
);
export const IconInbox = () => (
  <svg {...base}>
    <path d="M2.5 4.5h13v8h-7l-3.5 2.5v-2.5h-2.5z" />
  </svg>
);
export const IconRules = () => (
  <svg {...base}>
    <circle cx="5" cy="5" r="2" />
    <circle cx="13" cy="13" r="2" />
    <path d="M7 5h7M4 13h7M5 7v4M13 7v4" />
  </svg>
);
export const IconHome = () => (
  <svg {...base}>
    <path d="M3 8.5 9 3.5l6 5V15H3z" />
  </svg>
);
