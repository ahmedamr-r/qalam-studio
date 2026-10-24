import type { ReactNode } from "react";

import { AIGlyph, Mark } from "@/components/brand";
import type { Locale } from "@/lib/i18n";

import { Phone } from "./Phone";
import { TokenSheet } from "./TokenSheet";

/* The studio window, redrawn in HTML from the real chrome (app/globals.css dark theme, Figma UI3
   layout): top bar, icon rail + layers, canvas, design panel, floating toolbar. Chrome is English in
   both locales because the product is; the screen on the canvas follows the page's language. */

const LAYERS: [string, number, "frame" | "text" | "hash"][] = [
  ["Design tokens", 0, "hash"],
  ["Drafts", 0, "frame"],
  ["Send money", 0, "hash"],
  ["Header", 1, "frame"],
  ["You send", 1, "text"],
  ["They get", 1, "text"],
  ["Paying with", 1, "frame"],
  ["Arrives", 1, "frame"],
  ["Total fees", 1, "frame"],
  ["Continue", 1, "frame"],
];

export function StudioWindow({ lang, critic }: { lang: Locale; critic: string }) {
  return (
    <div className="studio" dir="ltr" lang="en">
      <div className="studio-top">
        <div className="studio-brand">
          <Mark size={18} />
          <b>Qalam Studio</b>
        </div>
        <span className="studio-sep" />
        <span className="studio-file">
          Tovi <i>/</i> Transfers
          <svg width="10" height="10" viewBox="0 0 20 20" aria-hidden>
            <path d="m4.5 8 5.5 5.5L15.5 8" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
        <span className="studio-top-fill" />
        <span className="studio-avatars">
          {["R", "S", "D", "C"].map((a, i) => (
            <i key={a} style={{ background: `var(--agent-${i + 1})` }}>
              {a}
            </i>
          ))}
        </span>
        <span className="studio-zoom">100%</span>
        <span className="studio-btn">Export</span>
        <span className="studio-generate">
          <AIGlyph size={14} ink />
          Generate
        </span>
      </div>

      <div className="studio-body">
        <div className="studio-rail">
          {RAIL.map((icon, i) => (
            <span key={i} className={i === 0 ? "is-on" : undefined}>
              {icon}
            </span>
          ))}
        </div>
        <div className="studio-layers">
          <div className="studio-tabs">
            <b>Layers</b>
            <span>Assets</span>
          </div>
          {LAYERS.map(([name, depth, kind], i) => (
            <div key={name} className={`studio-layer ${i === 9 ? "is-selected" : ""}`} style={{ paddingInlineStart: 12 + depth * 16 }}>
              <LayerIcon kind={kind} />
              {name}
            </div>
          ))}
        </div>

        <div className="studio-canvas dots">
          <div className="studio-frame-label" style={{ left: 392, top: 34 }}>
            Send money
          </div>
          <div className="studio-frame" style={{ left: 392, top: 56, width: 281, height: 593 }}>
            <Phone lang={lang} style={{ scale: 0.78, transformOrigin: "0 0" }} />
          </div>
          <div className="studio-frame-label" style={{ left: 40, top: 70 }}>
            Design tokens
          </div>
          <div style={{ position: "absolute", left: 40, top: 92 }}>
            <TokenSheet scale={0.8} />
          </div>
          <div className="comment-card studio-comment" style={{ left: 60, top: 388 }} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
            <div className="comment-head">
              <i style={{ background: "var(--agent-4)" }}>C</i>
              <b>Critic</b>
              <span>now</span>
            </div>
            <p>{critic}</p>
          </div>
          <Cursor name="Critic" n={4} x={238} y={500} />
          <Cursor name="Designer" n={3} x={656} y={420} />
          <div className="studio-toolbar">
            {TOOLS.map((icon, i) => (
              <span key={i} className={i === 0 ? "is-on" : undefined}>
                {icon}
              </span>
            ))}
            <span className="studio-toolbar-sep" />
            <span className="studio-ai-pill">
              <AIGlyph size={14} />
              Qalam AI
            </span>
          </div>
        </div>

        <div className="studio-panel">
          <div className="sp-section">
            <div className="sp-caption">Frame</div>
            <div className="sp-title">Send money</div>
            <div className="sp-fields">
              <span>
                <i>W</i>393
              </span>
              <span>
                <i>H</i>852
              </span>
            </div>
          </div>
          <div className="sp-section">
            <div className="sp-caption">Design system</div>
            <div className="sp-chip">
              <span className="sp-swatch" style={{ background: "#0a7570" }} />
              Tovi
            </div>
          </div>
          <div className="sp-section">
            <div className="sp-caption">Fill</div>
            <div className="sp-token">
              <span className="sp-swatch" style={{ background: "#ffffff" }} />
              bg/screen
            </div>
            <div className="sp-caption">Radius</div>
            <div className="sp-token">
              <span className="sp-radius" />
              radius/md
            </div>
          </div>
          <div className="sp-section">
            <div className="sp-caption">Checks</div>
            <div className="sp-check">
              <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden>
                <path d="m5 10.5 3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              0 issues
            </div>
          </div>
          <div className="sp-section">
            <div className="sp-caption">Built from</div>
            <div className="sp-source">
              <span className="sp-quote-mark">“</span>
              Interview 4, Salma
            </div>
            <div className="sp-source">
              <span className="sp-quote-mark">◇</span>
              Full cost before you send
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Cursor({ name, n, x, y, className }: { name: string; n: 1 | 2 | 3 | 4; x?: number; y?: number; className?: string }) {
  return (
    <div className={`cursor ${className ?? ""}`} style={{ left: x, top: y, ["--c" as string]: `var(--agent-${n})` }} data-cursor={name}>
      <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden>
        <path d="M1.5 1.5 14 8.6l-5.9 1.3-3 5.6L1.5 1.5Z" fill="var(--c)" stroke="#0b0b0a" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span>{name}</span>
    </div>
  );
}

function LayerIcon({ kind }: { kind: "frame" | "text" | "hash" }) {
  if (kind === "text")
    return (
      <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
        <path d="M4 4.5h12M10 4.5v12" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  if (kind === "hash")
    return (
      <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
        <path d="M7 3v14M13 3v14M3 7h14M3 13h14" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
      <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

const ic = (d: string): ReactNode => (
  <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const RAIL = [
  ic("M10 2.5 2.5 6.5 10 10.5l7.5-4L10 2.5ZM2.5 10l7.5 4 7.5-4M2.5 13.5l7.5 4 7.5-4"),
  ic("M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z"),
  ic("M10 3a7 7 0 1 0 0 14c1 0 1.5-.6 1.5-1.4 0-1.2-1-1.3-1-2.4 0-.8.7-1.4 1.6-1.4H14a3 3 0 0 0 3-3C17 5.6 13.9 3 10 3Z"),
  ic("M4 16 16 4M12 4h4v4"),
  ic("M5 3.5h8.5L16 6v10.5H5zM8 8h5M8 11h5"),
];
const TOOLS = [
  ic("M4 3l11.5 6.5-5.5 1.2-2.7 5.3L4 3Z"),
  ic("M6 2.5v15M14 2.5v15M2.5 6h15M2.5 14h15"),
  ic("M3.5 4.5h13v11h-13z"),
  ic("M3 17l2-6 8-8 4 4-8 8-6 2ZM11 5l4 4"),
  ic("M4 4.5h12M10 4.5v12"),
];
