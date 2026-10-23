/**
 * Recorded critique of the "Order tracking · Map first" demo screen: two question turns and a
 * verdict. Used when AI isn't configured, and labelled as a sample. Screen ids are filled in by
 * the client; node ids here are layer names, which the client resolves inside the screen.
 */
import type { CritiqueResult } from "./critique";
import type { RestyleResult } from "./ds-schemas";
import type { Inst, ScreenSpec } from "@/design-system/builders";

export const SAMPLE_CRITIQUE_TURNS: CritiqueResult[] = [
  {
    summary:
      "A familiar tracking layout: the live map and courier card match what people expect from delivery apps. The arrival time competes with the map for attention, and the sheet offers two equal-weight contact buttons.",
    issues: [
      { screenId: "", nodeId: "Arrives in 12 min", heuristic: "visual-hierarchy", severity: "major", issue: "The arrival time sits below a 300px map in body-weight text, so the eye lands on the map first.", fix: "Promote the ETA to the largest text on screen, above the map or as a pill on it." },
      { screenId: "", nodeId: "", heuristic: "visibility-of-status", severity: "major", issue: "Nothing says how fresh the location is, so a stalled courier looks the same as a moving one.", fix: "Add \"Updated just now\" under the ETA and animate the courier pin." },
      { screenId: "", nodeId: "Message", heuristic: "aesthetic-minimalist", severity: "minor", issue: "Call and Message look like equal choices, and it isn't clear which one the courier expects.", fix: "Keep one primary contact action and make the other a secondary icon button." },
      { screenId: "", nodeId: "", heuristic: "user-control", severity: "minor", issue: "There's no way to see order details or change delivery instructions from here.", fix: "Add an \"Order details\" row in the sheet." },
    ],
    goalFit: { verdict: "unknown", confidence: "low", rationale: "I don't know yet what this screen has to achieve, so I can't judge it against its goal.", mustChange: [] },
    question: {
      topic: "goal",
      text: "The map takes almost half the screen. When someone opens this, what is the one thing they came to find out?",
      why: "If it's the arrival time, the map is competing with the answer; if it's reassurance that the food is moving, the map is right to lead.",
      options: ["When it will arrive", "Where the courier is", "That it's on track", "How to reach the courier"],
      screenId: "",
    },
    brief: { summary: "", screens: [] },
  },
  {
    summary: "If people come for the arrival time, the screen answers it, but second: the map wins the first glance.",
    issues: [
      { screenId: "", nodeId: "", heuristic: "visual-hierarchy", severity: "critical", issue: "The map is the loudest element and pushes the answer down; on smaller phones the ETA can end up below the fold.", fix: "Shrink the map to about 180px or overlay a large ETA on it." },
    ],
    goalFit: {
      verdict: "partially",
      confidence: "low",
      rationale: "The ETA is there, but it isn't what people see first.",
      mustChange: [{ nodeId: "Arrives in 12 min", change: "Make the ETA the largest text on the screen." }],
    },
    question: {
      topic: "audience",
      text: "Do people glance at this for a second (at work, cooking), or watch it closely while waiting at the door?",
      why: "A quick glance needs one big number; watching closely justifies the live map.",
      options: ["A quick glance", "Watching closely", "Depends on the ETA"],
      screenId: "",
    },
    brief: { summary: "", screens: [] },
  },
  {
    summary: "Everything needed is on the screen; the hierarchy is what stands between it and the goal.",
    issues: [],
    goalFit: {
      verdict: "partially",
      confidence: "medium",
      rationale: "For someone checking when their food arrives, the arrival time has to win the first second, and today the map does. Fix the hierarchy and this screen meets its goal.",
      mustChange: [
        { nodeId: "Arrives in 12 min", change: "Make the ETA the largest text on screen, with \"Updated just now\" under it." },
        { nodeId: "", change: "Shorten the map so the ETA and courier card sit above the fold." },
        { nodeId: "Message", change: "Keep one primary contact action." },
      ],
    },
    question: null,
    brief: { summary: "", screens: [] },
  },
];

const ETA = "12 min";
const FRESHNESS = "Arriving around 6:42 PM · updated just now";

/**
 * Recorded fixes for the same demo screen, by heuristic: "Fix all" applies every one (no
 * heuristics given), an issue's own Fix only the steps for its heuristic. Each step skips itself
 * when the screen already has it, so single fixes can follow one another. Other screens need live AI.
 */
export function sampleFix(spec: ScreenSpec | undefined, heuristics?: string[]): RestyleResult | null {
  if (!spec || spec.name !== "Order tracking · Map first") return null;
  const screen = structuredClone(spec);
  const want = (h: string) => !heuristics || heuristics.includes(h);
  const find = (list: Inst[] | undefined, test: (i: Inst) => boolean): Inst | undefined => {
    for (const i of list ?? []) {
      if (test(i)) return i;
      const hit = find(i.children, test);
      if (hit) return hit;
    }
  };
  const textAt = (text: string) => screen.body.findIndex((i) => i.component === "Text" && i.props?.text === text);
  const done: { inst: Inst; summary: string }[] = [];

  if (want("visual-hierarchy")) {
    if (textAt(ETA) < 0) {
      const eta: Inst = { component: "Text", props: { text: ETA, style: "display" } };
      screen.body.unshift(eta);
      done.push({ inst: eta, summary: "The arrival time is now the largest text on screen, above the map (visual hierarchy)." });
    }
    const map = find(screen.body, (i) => i.component === "MapPlaceholder");
    if (map && map.props?.height !== 180) {
      map.props = { ...map.props, height: 180, eta: "" };
      done.push({ inst: map, summary: "Map shortened to 180px and its duplicate ETA pill removed, so the ETA leads." });
    }
    const tracker = find(screen.body, (i) => i.component === "ProgressTracker");
    if (tracker && tracker.props?.title !== "On the way") {
      tracker.props = { ...tracker.props, title: "On the way" };
      done.push({ inst: tracker, summary: "Tracker title no longer repeats the ETA." });
    }
  }
  if (want("visibility-of-status") && textAt(FRESHNESS) < 0) {
    const fresh: Inst = { component: "Text", props: { text: FRESHNESS, style: "caption", tone: "secondary" } };
    screen.body.splice(textAt(ETA) + 1, 0, fresh);
    done.push({ inst: fresh, summary: "Added the clock time and \"updated just now\" so a stalled courier is visible (system status)." });
  }
  if (want("aesthetic-minimalist")) {
    const message = find(screen.footer, (i) => i.component === "Button" && i.props?.label === "Message");
    if (message && message.props?.variant !== "secondary") {
      message.props = { ...message.props, variant: "secondary" };
      done.push({ inst: message, summary: "Message is secondary, so Call and Message no longer look like equal choices." });
    }
  }
  if (want("user-control")) {
    const sheet = find(screen.footer, (i) => i.component === "BottomSheet");
    if (sheet && !find(sheet.children, (i) => i.component === "ListItem" && i.props?.title === "Order details")) {
      const row: Inst = { component: "ListItem", props: { title: "Order details", subtitle: "2 items · Delivery instructions", leadingIcon: "shopping-bag", trailing: "chevron" } };
      sheet.children = [...(sheet.children ?? []).slice(0, 1), row, ...(sheet.children ?? []).slice(1)];
      done.push({ inst: row, summary: "Added an \"Order details\" row to the sheet, where delivery instructions can be changed (user control)." });
    }
  }

  // Spec paths of the changed components, once every step has moved things around.
  const pathOf = (target: Inst): string => {
    const walk = (list: Inst[] | undefined, at: string): string => {
      for (const [k, i] of (list ?? []).entries()) {
        const here = `${at}.${k}`;
        if (i === target) return here;
        const hit = walk(i.children, `${here}.children`);
        if (hit) return hit;
      }
      return "";
    };
    return walk(screen.header, "header") || walk(screen.body, "body") || walk(screen.footer, "footer");
  };
  return { screen, changes: done.map((d) => ({ path: pathOf(d.inst), summary: d.summary })) };
}
