import { createContext, useContext, useId } from "react";

/*
 * The researcher: who goes out and reads what people say while someone waits, in the first run.
 * Drawn flat, in colours of its own so it reads the same on either theme, with soft gradients on
 * the outfit for a little volume; the pen and the magnifier take the app's accent.
 */

export type ResearcherPose = "idle" | "reading" | "writing" | "found" | "shrug";

export const RESEARCHER_POSES: readonly ResearcherPose[] = ["idle", "reading", "writing", "found", "shrug"];

const SKIN = "#d8a884";
const SKIN_SHADE = "#bd8c69";
const HAIR = "#46342a";
const HAIR_SHADE = "#35261e";
const STRING = "#a2a5ae";
const PAPER = "#efe9dc";
const INK = "#1b1613";
const ACCENT = "var(--color-accent)";

/** This drawing's arm gradient: an id can't be shared, since a copy hidden by a narrow window would hide it for the others. */
const ArmPaint = createContext("none");

function Arm({ d }: { d: string }) {
  const paint = useContext(ArmPaint);
  return <path d={d} fill="none" stroke={paint} strokeWidth={21} strokeLinecap="round" strokeLinejoin="round" />;
}

const Hand = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={10.500} fill={SKIN} />;

/** The ring and handle, the ring's centre at (x, y) and the handle ending at the hand. */
function Magnifier({ x, y, r, hand }: { x: number; y: number; r: number; hand: [number, number] }) {
  const long = Math.hypot(hand[0] - x, hand[1] - y);
  return (
    <g>
      <line x1={x + ((hand[0] - x) * r) / long} y1={y + ((hand[1] - y) * r) / long} x2={hand[0]} y2={hand[1]} stroke={ACCENT} strokeWidth={7} strokeLinecap="round" />
      <circle cx={x} cy={y} r={r} fill="#ffffff" fillOpacity={0.16} stroke={ACCENT} strokeWidth={6} />
    </g>
  );
}

/** A half-lidded eye: the lid is what makes it deadpan, so only `open` lifts it. */
function Eye({ x, y, look = 0, open = false, big = 1 }: { x: number; y: number; look?: number; open?: boolean; big?: number }) {
  const r = 9 * big;
  const lid = open ? y - r * 0.55 : y - r * 0.12;
  const half = Math.sqrt(r * r - (y - lid) * (y - lid));
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#fbf7f0" />
      <circle cx={x} cy={y + 2 * big + look} r={4.600 * big} fill={INK} />
      <path d={`M${x - half} ${lid} A${r} ${r} 0 0 1 ${x + half} ${lid} Z`} fill={SKIN_SHADE} />
      <line x1={x - half - 1} y1={lid} x2={x + half + 1} y2={lid} stroke={INK} strokeWidth={2.600} strokeLinecap="round" />
    </g>
  );
}

function Face({ pose }: { pose: ResearcherPose }) {
  const look = pose === "writing" ? 3 : 0;
  const raised = pose === "found";
  return (
    <g>
      <Eye x={101} y={99} look={look} />
      {pose === "reading" ? <Eye x={139} y={99} big={1.600} open /> : <Eye x={139} y={99} look={look} open={raised} />}
      <line x1={90} y1={84} x2={112} y2={84} stroke={HAIR_SHADE} strokeWidth={5} strokeLinecap="round" />
      {raised ? <path d="M128 78 Q139 69 151 76" fill="none" stroke={HAIR_SHADE} strokeWidth={5} strokeLinecap="round" /> : pose === "reading" ? null : <line x1={128} y1={84} x2={150} y2={84} stroke={HAIR_SHADE} strokeWidth={5} strokeLinecap="round" />}
      <path d="M120 100 L114 117 Q120 121 126 117 Z" fill={SKIN_SHADE} />
    </g>
  );
}

function Pose({ pose }: { pose: ResearcherPose }) {
  switch (pose) {
    case "idle":
      return (
        <g>
          <Arm d="M78 192 L64 246" />
          <Hand x={62} y={254} />
          <Magnifier x={208} y={204} r={19} hand={[184, 250]} />
          <Arm d="M162 192 L178 244" />
          <Hand x={181} y={252} />
        </g>
      );
    case "reading":
      return (
        <g>
          <Arm d="M78 192 L64 246" />
          <Hand x={62} y={254} />
          <Arm d="M162 192 L184 170" />
          <Magnifier x={139} y={99} r={25} hand={[184, 160]} />
          <Hand x={186} y={164} />
        </g>
      );
    case "writing":
      return (
        <g>
          <Arm d="M78 192 L70 226" />
          <rect x={54} y={192} width={62} height={72} rx={4} fill={PAPER} transform="rotate(-6 85 228)" />
          <path d="M66 212 L104 208 M67 224 L105 220 M68 236 L92 234" stroke={SKIN_SHADE} strokeWidth={3} strokeLinecap="round" />
          <Hand x={68} y={238} />
          <Arm d="M162 192 L128 232" />
          <line x1={110} y1={236} x2={136} y2={200} stroke={ACCENT} strokeWidth={7} strokeLinecap="round" />
          <Hand x={120} y={232} />
        </g>
      );
    case "found":
      return (
        <g>
          <Arm d="M78 192 L64 246" />
          <Hand x={62} y={254} />
          <Arm d="M162 192 L188 142" />
          <rect x={164} y={66} width={58} height={70} rx={4} fill={PAPER} transform="rotate(7 193 101)" />
          <path d="M180 88 Q176 96 180 104 M190 88 Q186 96 190 104" fill="none" stroke={ACCENT} strokeWidth={5} strokeLinecap="round" />
          <path d="M200 96 L214 98 M198 108 L212 110" stroke={SKIN_SHADE} strokeWidth={3} strokeLinecap="round" />
          <Hand x={190} y={136} />
        </g>
      );
    case "shrug":
      return (
        <g>
          <Arm d="M78 192 L42 202 L36 176" />
          <Hand x={35} y={168} />
          <Arm d="M162 192 L198 202 L204 176" />
          <Hand x={205} y={168} />
        </g>
      );
  }
}

/** The researcher in one of its poses. `size` is its height; its width follows. */
export function Researcher({ pose = "idle", size = 240, className }: { pose?: ResearcherPose; size?: number; className?: string }) {
  const id = useId().replace(/\W/g, "");
  const [body, arm, hood, hem, shoe] = ["body", "arm", "hood", "hem", "shoe"].map((part) => `researcher-${part}-${id}`);
  return (
    <svg viewBox="0 0 240 300" width={(size * 240) / 300} height={size} className={className} aria-hidden="true">
      <defs>
        {/* Light from the upper left, falling off softly round the body */}
        <radialGradient id={body} cx="0.36" cy="0.2" r="0.95">
          <stop offset="0" stopColor="#666a78" />
          <stop offset="0.5" stopColor="#3e414b" />
          <stop offset="1" stopColor="#23252b" />
        </radialGradient>
        <linearGradient id={arm} gradientUnits="userSpaceOnUse" x1="50" y1="150" x2="190" y2="270">
          <stop offset="0" stopColor="#6a6e7c" />
          <stop offset="1" stopColor="#2c2e35" />
        </linearGradient>
        <linearGradient id={hood} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#50535f" />
          <stop offset="1" stopColor="#23252b" />
        </linearGradient>
        <linearGradient id={hem} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#3a3c46" />
          <stop offset="1" stopColor="#1e2025" />
        </linearGradient>
        <linearGradient id={shoe} x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#3f4149" />
          <stop offset="1" stopColor="#17181c" />
        </linearGradient>
      </defs>
      <ellipse cx={120} cy={290} rx={66} ry={7} fill="currentColor" opacity={0.1} />
      {/* The hair behind the head and over the shoulders */}
      <path d="M72 96 C66 136 62 172 66 204 L92 196 L148 196 L174 204 C178 172 174 136 168 96 C160 60 80 60 72 96 Z" fill={HAIR_SHADE} />
      {/* Shoes, then the hoodie */}
      <ellipse cx={94} cy={284} rx={23} ry={9} fill={`url(#${shoe})`} />
      <ellipse cx={146} cy={284} rx={23} ry={9} fill={`url(#${shoe})`} />
      <path d="M78 186 C78 172 94 164 120 164 C146 164 162 172 162 186 L168 262 C168 276 156 282 120 282 C84 282 72 276 72 262 Z" fill={`url(#${body})`} />
      <path d="M92 168 C100 182 140 182 148 168 C154 172 156 176 152 182 C140 198 100 198 88 182 C84 176 86 172 92 168 Z" fill={`url(#${hood})`} />
      <path d="M78 248 L162 248 L166 272 C150 282 90 282 74 272 Z" fill={`url(#${hem})`} />
      <path d="M108 190 L106 214 M132 190 L134 214" stroke={STRING} strokeWidth={3} strokeLinecap="round" fill="none" />
      {/* The pen in its chest pocket */}
      <rect x={140} y={204} width={22} height={18} rx={2} fill={`url(#${hem})`} />
      <line x1={151} y1={208} x2={154} y2={190} stroke={ACCENT} strokeWidth={5} strokeLinecap="round" />
      <rect x={140} y={208} width={22} height={14} rx={2} fill={`url(#${hem})`} />
      {/* Face and neck */}
      <rect x={104} y={140} width={32} height={34} fill={SKIN_SHADE} />
      <ellipse cx={120} cy={102} rx={45} ry={52} fill={SKIN} />
      {/* The beard, mouth in it */}
      <path d="M75 104 C80 122 92 126 104 124 C112 122 128 122 136 124 C148 126 160 122 165 104 C170 142 152 176 120 176 C88 176 70 142 75 104 Z" fill={HAIR} />
      <path d="M110 140 L130 140" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <Face pose={pose} />
      {/* The hair, parted in the middle, down both sides of the face */}
      <path d="M120 50 C96 44 74 58 70 92 C66 124 62 160 64 192 C72 192 80 186 82 176 C78 150 78 118 84 96 C90 76 104 64 120 58 Z" fill={HAIR} />
      <path d="M120 50 C144 44 166 58 170 92 C174 124 178 160 176 192 C168 192 160 186 158 176 C162 150 162 118 156 96 C150 76 136 64 120 58 Z" fill={HAIR} />
      <ArmPaint.Provider value={`url(#${arm})`}>
        <Pose pose={pose} />
      </ArmPaint.Provider>
    </svg>
  );
}
