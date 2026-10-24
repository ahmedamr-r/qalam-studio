"use client";

import { useRef } from "react";

import { Artboard } from "@/components/Artboard";
import { AIGlyph } from "@/components/brand";
import { useLocale } from "@/components/locale";
import { useScene } from "@/components/motion/useScene";
import { Scene } from "@/components/Scene";
import { quoted } from "@/lib/i18n";

/* Step 2. The Opportunity Solution Tree draws itself; the quote from step 1 lands on "Fees show up
   too late" and its Assumed badge turns into evidence; the other two stay Assumed. Then the
   solution is picked and Design this is pressed. */

const W = 220;
const NODES = {
  outcome: { x: 360, y: 24 },
  opp0: { x: 50, y: 200 },
  opp1: { x: 360, y: 200 },
  opp2: { x: 670, y: 200 },
  sol0: { x: 24, y: 410 },
  sol1: { x: 264, y: 410 },
};
const H = 92;
const edge = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const x1 = a.x + W / 2;
  const y1 = a.y + H;
  const x2 = b.x + W / 2;
  const y2 = b.y;
  const my = (y1 + y2) / 2;
  return `M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
};

export function TreeScene() {
  const { t, locale } = useLocale();
  const ref = useRef<HTMLElement>(null);
  const c = t.tree;

  useScene(ref, (tl, { sx }) => {
    tl.fromTo(".ost-node", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, stagger: 0.035, duration: 0.06 }, 0)
      .fromTo(".ost-edge", { strokeDashoffset: 1 }, { strokeDashoffset: 0, stagger: 0.03, duration: 0.1 }, 0.04)
      // The quote from step 1 arrives from the far side and lands on the first opportunity.
      .fromTo(
        ".ost-quote",
        { opacity: 0, x: 520 * sx, y: 330, scale: 1.1 },
        { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.14, ease: "power2.inOut" },
        0.3,
      )
      .to(".ost-opp0 .badge-assumed", { opacity: 0, scale: 0.9, duration: 0.03 }, 0.44)
      .fromTo(".ost-opp0 .badge-evidence", { opacity: 0, scale: 1.2 }, { opacity: 1, scale: 1, duration: 0.04 }, 0.46)
      .to(".ost-opp0", { "--dash": 0, duration: 0.04 }, 0.44)
      .fromTo(".ost-assumed-pulse", { opacity: 0 }, { opacity: 1, duration: 0.04, yoyo: true, repeat: 1 }, 0.5)
      .fromTo(".ost-sol0", { "--sel": 0 }, { "--sel": 1, duration: 0.04 }, 0.68)
      .fromTo(".ost-design", { opacity: 0, y: -10, scale: 1.1 }, { opacity: 1, y: 0, scale: 1, duration: 0.05 }, 0.74)
      .to(".ost-design", { scale: 0.96, duration: 0.02 }, 0.86)
      .to(".ost-design", { scale: 1, duration: 0.03 }, 0.88)
      .fromTo(".ost-design-glow", { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1.4, duration: 0.05 }, 0.87)
      .to(".ost-design-glow", { opacity: 0, duration: 0.04 }, 0.92);
  });

  const nodes: [keyof typeof NODES, string, string, "assumed" | "evidence" | null, string?][] = [
    ["outcome", c.outcomeKind, c.outcome, null],
    ["opp0", c.oppKind, c.opps[0], "assumed"],
    ["opp1", c.oppKind, c.opps[1], "assumed"],
    ["opp2", c.oppKind, c.opps[2], "assumed"],
    ["sol0", c.solKind, c.sols[0], null],
    ["sol1", c.solKind, c.sols[1], null],
  ];

  return (
    <Scene
      id="tree"
      sceneRef={ref}
      beats={3.5}
      step={2}
      captions={[
        { title: c.title, body: c.body },
        { title: c.title2, body: c.body2 },
        { title: c.title3, body: c.body3 },
      ]}
    >
      <Artboard w={940} h={600} className="canvas-board">
        <svg className="ost-edges flip-x" viewBox="0 0 940 600" aria-hidden>
          {[
            ["outcome", "opp0"],
            ["outcome", "opp1"],
            ["outcome", "opp2"],
            ["opp0", "sol0"],
            ["opp0", "sol1"],
          ].map(([a, b]) => (
            <path key={b} className="ost-edge" d={edge(NODES[a as keyof typeof NODES], NODES[b as keyof typeof NODES])} pathLength={1} />
          ))}
        </svg>
        {nodes.map(([id, kind, text, badge]) => (
          <div
            key={id}
            className={`ost-node ost-${id} ost-kind-${id.replace(/\d/, "")} ${badge === "assumed" ? "is-assumed" : ""}`}
            style={{ insetInlineStart: NODES[id].x, top: NODES[id].y, width: W, minHeight: H }}
          >
            <span className="ost-kind">{kind}</span>
            <span className="ost-text">{text}</span>
            {badge && (
              <span className="ost-badges">
                <span className="badge badge-assumed">
                  <AIGlyph size={12} />
                  {c.assumed}
                </span>
                {id === "opp0" && <span className="badge badge-evidence">{c.evidence}</span>}
              </span>
            )}
            {id !== "opp0" && badge === "assumed" && <span className="ost-assumed-pulse" aria-hidden />}
          </div>
        ))}
        <div className="ost-quote" style={{ insetInlineStart: NODES.opp0.x + 12, top: NODES.opp0.y + H + 18 }}>
          {quoted(t.quote.quote, locale)}
        </div>
        <div className="ost-design-wrap" style={{ insetInlineStart: NODES.sol0.x + 20, top: NODES.sol0.y + H + 26 }}>
          <span className="ost-design-glow" aria-hidden />
          <span className="btn-saffron ost-design">
            <AIGlyph size={14} ink />
            {c.designThis}
          </span>
        </div>
      </Artboard>
    </Scene>
  );
}
