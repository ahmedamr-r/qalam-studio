/**
 * The extraction's "structure" section: how each component is BUILT in the screenshots, as enums
 * generated from the structure registry (src/design-system/styles.ts), so the model can only pick
 * values the studio can draw. The studio then measures what it can in the pixels and corrects the
 * model where the pixels are decisive (src/design-system/structure.ts).
 */
import { STYLE_AXES, STYLE_GROUPS } from "@/design-system/styles";

type JSONSchema = Record<string, unknown>;

const obj = (properties: Record<string, JSONSchema>, description?: string): JSONSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
  ...(description ? { description } : {}),
});

/** Key of a recipe group in the schema, e.g. "component.nav-bar" → "nav-bar". */
export const structureKey = (group: string) => group.slice("component.".length);

export const STRUCTURE_SCHEMA: JSONSchema = obj(
  Object.fromEntries(
    STYLE_GROUPS.map((group) => {
      const axes = STYLE_AXES.filter((a) => a.group === group);
      const component = axes[0].component;
      return [
        structureKey(group),
        obj(
          {
            visible: { type: "boolean", description: `Is a ${component} visible in the screenshots?` },
            ...Object.fromEntries(axes.map((a) => [a.axis, { type: "string", enum: [...a.values], description: `${a.description}: ${a.values.map((v) => `${v} = ${a.valueHelp[v]}`).join("; ")}` }])),
            evidence: { type: "string", description: "What you saw, e.g. 'a pill-shaped bar inset ~24px from both sides, 3 icons, no labels'. Empty if not visible." },
          },
          `${component}: ${axes.map((a) => a.axis).join(", ")}`,
        ),
      ];
    }),
  ),
  "How each component is built in the screenshots: structure, not colours. For components you can't see, set visible: false and pick what the design language implies.",
);

export interface StructureGroup {
  visible: boolean;
  evidence: string;
  [axis: string]: string | boolean;
}
export type StructureResult = Record<string, StructureGroup>;

export const STRUCTURE_PROMPT = `- Component structure ("structure"): how each component is BUILT, independent of its colours. The studio draws each option, so pick what the screenshots show, not the most common pattern. Look closely:
  - Tab bar: a full-width bar along the bottom edge, or a rounded pill floating above it with space on both sides? Labels under every icon, under the active one only, or icons only? Is the active tab marked by a shape behind its icon, a dot, a short line, or colour alone?
  - Top bar: is the screen title centred, next to the back button, or large on its own line below the bar (like "Add money" on a page with a big heading)?
  - Tabs: a line under the selected tab, or a filled pill behind it?
  - List rows: is the leading icon bare or inside a filled shape? Are rows separated by lines (edge to edge, or starting at the text)? Do rows end in a chevron?
  - Service tiles: filled cards, or bare icons with labels on the page?
  Set visible: false for components not in the screenshots. Point at them in elements too (nav-bar, nav-active, top-bar-title, tabs-active, list-item, list-leading): the studio measures those in the pixels and corrects the structure where the pixels are clear.`;
