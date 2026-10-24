/* Small UI icons shared by the mocks: 20px grid, round caps. */
const S = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconCheck = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <path d="m4.5 10.5 3.6 3.6L15.5 6.5" {...S} strokeWidth={2.2} />
  </svg>
);
export const IconX = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" {...S} strokeWidth={2.2} />
  </svg>
);
/** The linter's warning mark: always a ring, never a filled dot (the studio's rule). */
export const IconRing = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <circle cx="10" cy="10" r="6.2" {...S} strokeWidth={2.2} />
  </svg>
);
export const IconPin = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <path d="M12.5 2.5 17.5 7.5l-2.2.6-3.4 3.4.4 3.6-1.6 1.6-3-3-4.2 4.2M6.6 10.2l3.4-3.4.6-2.2" {...S} strokeWidth={1.6} />
  </svg>
);
export const IconSearch = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <circle cx="9" cy="9" r="5.5" {...S} strokeWidth={1.7} />
    <path d="m13.2 13.2 3.8 3.8" {...S} strokeWidth={1.7} />
  </svg>
);
export const IconPause = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <path d="M7 4.5v11M13 4.5v11" {...S} strokeWidth={2.4} />
  </svg>
);
export const IconPlay = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
    <path d="M6.5 4.2v11.6L16 10 6.5 4.2Z" fill="currentColor" />
  </svg>
);
