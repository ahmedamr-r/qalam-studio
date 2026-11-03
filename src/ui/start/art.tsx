/* The two cards' pictures, in the same flat look as the researcher. */

const ACCENT = "var(--color-accent)";

/** A product with people using it and a number going up. */
export function CompanyArt() {
  return (
    <svg viewBox="0 0 220 112" className="w-full" aria-hidden="true">
      <rect x="24" y="10" width="124" height="90" rx="6" fill="currentColor" opacity="0.08" />
      <rect x="24" y="10" width="124" height="16" rx="6" fill="currentColor" opacity="0.1" />
      <circle cx="34" cy="18" r="2.500" fill="currentColor" opacity="0.4" />
      <circle cx="42" cy="18" r="2.500" fill="currentColor" opacity="0.4" />
      <rect x="38" y="66" width="14" height="22" rx="2" fill="currentColor" opacity="0.2" />
      <rect x="60" y="54" width="14" height="34" rx="2" fill="currentColor" opacity="0.2" />
      <rect x="82" y="60" width="14" height="28" rx="2" fill="currentColor" opacity="0.2" />
      <rect x="104" y="40" width="14" height="48" rx="2" fill={ACCENT} />
      <g fill="#34363d">
        <path d="M150 104 C150 86 160 78 172 78 C184 78 194 86 194 104 Z" />
        <path d="M128 104 C128 92 136 86 146 86 C156 86 164 92 164 104 Z" />
      </g>
      <circle cx="172" cy="64" r="12" fill="#d8a884" />
      <circle cx="146" cy="76" r="9" fill="#bd8c69" />
      <circle cx="196" cy="78" r="8" fill="#bd8c69" />
      <path d="M180 104 C180 96 186 90 196 90 C206 90 212 96 212 104 Z" fill="#282a30" />
    </svg>
  );
}

/** One idea, not yet proven, and the notes around it. */
export function IdeaArt() {
  return (
    <svg viewBox="0 0 220 112" className="w-full" aria-hidden="true">
      <rect x="18" y="26" width="52" height="60" rx="4" fill="currentColor" opacity="0.08" transform="rotate(-6 44 56)" />
      <path d="M28 44 L58 41 M29 56 L59 53 M30 68 L48 66" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" strokeLinecap="round" />
      <rect x="150" y="30" width="52" height="60" rx="4" fill="currentColor" opacity="0.08" transform="rotate(5 176 60)" />
      <path d="M161 48 L191 51 M160 60 L190 63 M159 72 L177 73" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" strokeLinecap="round" />
      <path d="M110 14 C128 14 140 28 140 44 C140 56 133 63 128 70 C125 74 124 78 124 82 L96 82 C96 78 95 74 92 70 C87 63 80 56 80 44 C80 28 92 14 110 14 Z" fill={ACCENT} />
      <rect x="97" y="86" width="26" height="7" rx="3" fill="currentColor" opacity="0.35" />
      <rect x="100" y="96" width="20" height="6" rx="3" fill="currentColor" opacity="0.25" />
      <path d="M100 42 L110 52 L120 42 M110 52 L110 80" fill="none" stroke="#141412" strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
