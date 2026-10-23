/**
 * Recorded sample outputs used when AI isn't configured on a deployment, so the flows remain
 * explorable. The UI always labels these as samples.
 */
import type { ExtractResult, GenerateResult } from "./schemas";
import { DEMO_SCREENS } from "@/ui/demo";

export const SAMPLE_GENERATE: GenerateResult = {
  approach: "Three takes on order tracking: one leads with the live map, one with a step-by-step timeline, and one keeps everything compact for a quick glance.",
  // Ids of the built-in system's facts as its prompt numbers them (checked in knowledge.test.ts).
  reliedOn: [
    { id: "d26", why: "Led with the map, then the progress and the order card, as the Tracking template lays out." },
    { id: "d14", why: "Kept one primary action per screen, pinned in the footer." },
    { id: "d13", why: "Used real restaurant names, ETAs and AED prices in the copy." },
  ],
  assumed: [
    { topic: "audience", guess: "People waiting for a food delivery who glance at the screen while doing something else." },
    { topic: "primary-action", guess: "Contacting the courier matters more than cancelling." },
  ],
  variants: DEMO_SCREENS,
  offSystem: [
    { need: "Live courier location on a real map", workaround: "MapPlaceholder with ETA pill", proposal: "LiveMap component with courier marker, route polyline and recenter button" },
    { need: "Courier photo", workaround: "Avatar with initials", proposal: "Avatar/Photo variant with image source and fallback initials" },
    { need: "Tip the courier after delivery", workaround: "Not shown", proposal: "TipSelector (ChipGroup variant with currency amounts and custom input)" },
  ],
};

export const SAMPLE_EXTRACT_CSS: ExtractResult = {
  summary:
    "A legacy checkout stylesheet with one green (#00A651) doing three jobs — primary action, success feedback and price emphasis — plus a near-duplicate hover green and an ad-hoc grey caption that fails contrast.",
  namingConvention: "group.role-modifier, kebab-case (bg.*, text.*, feedback.*, radius.*, space.*)",
  suggestions: [
    { sourceId: "v1", value: "#00A651", type: "color", usage: ".btn-primary { background }", intent: "brand primary action", name: "bg.brand-strong", existingToken: "", action: "split", group: "g-green", confidence: 0.92, reasoning: "Fills the main call to action — identity, not status. Our library uses Forest Green for this role; keep it separate from success." },
    { sourceId: "v1", value: "#00A651", type: "color", usage: ".toast--success { border-left }", intent: "success feedback", name: "feedback.success", existingToken: "feedback.success", action: "split", group: "g-green", confidence: 0.9, reasoning: "Same hex as the button today, but it means 'it worked'. If brand green changes, success must not." },
    { sourceId: "v1", value: "#00A651", type: "color", usage: ".price-tag { color }", intent: "price emphasis", name: "text.success", existingToken: "", action: "split", group: "g-green", confidence: 0.55, reasoning: "Likely borrowed brand colour for emphasis; #00A651 on white is 3.2:1, too low for 18px bold price text — map to a darker text token." },
    { sourceId: "v2", value: "#00A650", type: "color", usage: ".btn-primary:hover { background }", intent: "brand primary action (hover)", name: "bg.brand-strong", existingToken: "", action: "merge", group: "g-hover", confidence: 0.86, reasoning: "1-digit off #00A651 on the same element: a typo, not a new colour. Merge and derive hover from the token." },
    { sourceId: "v5", value: "#8A8A8A", type: "color", usage: ".caption, .meta { color } at 14px", intent: "secondary text", name: "text.secondary", existingToken: "text.secondary", action: "reuse-existing", group: "", confidence: 0.94, reasoning: "Classic custom 14px grey caption. text.secondary (#56615D) has the same intent and passes AA; #8A8A8A is 3.5:1." },
    { sourceId: "v3", value: "#FFFFFF", type: "color", usage: ".header { background }, .btn-primary { color }", intent: "page surface / text on brand", name: "bg.canvas", existingToken: "bg.canvas", action: "split", group: "g-white", confidence: 0.8, reasoning: "White as a page background is bg.canvas." },
    { sourceId: "v3", value: "#FFFFFF", type: "color", usage: ".btn-primary { color }", intent: "label on primary action", name: "text.on-brand-strong", existingToken: "", action: "split", group: "g-white", confidence: 0.7, reasoning: "White label on the button is a role of its own (on-brand text); our system uses the periwinkle accent there." },
    { sourceId: "v4", value: "#E6E6E6", type: "color", usage: ".header { border-bottom }, .chip, .input { border }", intent: "default border", name: "border.default", existingToken: "border.default", action: "reuse-existing", group: "", confidence: 0.88, reasoning: "Hairline borders on inputs and chips; ΔE 2.1 from border.default." },
    { sourceId: "v6", value: "#F2F2F2", type: "color", usage: ".card { background }", intent: "grouped content surface", name: "bg.surface", existingToken: "bg.surface", action: "reuse-existing", group: "", confidence: 0.9, reasoning: "Grey card behind content = bg.surface." },
    { sourceId: "v7", value: "#E53935", type: "color", usage: ".error { color }", intent: "error text", name: "text.error", existingToken: "text.error", action: "reuse-existing", group: "", confidence: 0.85, reasoning: "Error messaging; library red passes AA while this one is borderline at 13px." },
    { sourceId: "v8", value: "#0B5D32", type: "color", usage: ".toast--success { color }, .link { color }", intent: "success text / link", name: "text.link", existingToken: "text.link", action: "split", group: "g-dark-green", confidence: 0.6, reasoning: "Shared by success copy and links. Links and success copy have different meanings — keep text.link and text.success apart." },
    { sourceId: "v9", value: "#004D40", type: "color", usage: ".promo--plus { background }", intent: "Plus sub-brand surface", name: "bg.brand-strong", existingToken: "bg.brand-strong", action: "reuse-existing", group: "", confidence: 0.83, reasoning: "A dark brand surface for the Plus promo — reuse, don't fork." },
    { sourceId: "d1", value: "14px", type: "dimension", usage: ".btn-primary { border-radius }", intent: "button corner", name: "radius.pill", existingToken: "radius.pill", action: "reuse-existing", group: "", confidence: 0.7, reasoning: "Buttons are pills in the system; 14px is an off-scale one-off." },
    { sourceId: "d2", value: "10px", type: "dimension", usage: ".card { border-radius }", intent: "card corner", name: "radius.lg", existingToken: "radius.lg", action: "reuse-existing", group: "", confidence: 0.8, reasoning: "Cards use radius.lg (16px); 10px is off-scale." },
    { sourceId: "d3", value: "12px", type: "dimension", usage: ".toast--success, .input { border-radius }", intent: "input / message corner", name: "radius.md", existingToken: "radius.md", action: "reuse-existing", group: "", confidence: 0.92, reasoning: "Exact match for radius.md with the same intent." },
    { sourceId: "d4", value: "13px", type: "dimension", usage: ".chip, .error { font-size }", intent: "small UI text", name: "type.caption-strong", existingToken: "type.caption-strong", action: "merge", group: "g-small", confidence: 0.65, reasoning: "13px sits between caption (12) and label (14); merge onto the type scale rather than adding a size." },
  ],
  rebuild: null,
};
