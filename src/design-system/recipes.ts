/**
 * Which component recipe groups (`component.<group>.*`) each catalog component is drawn with, as
 * read from builders.ts. Components missing here are styled by semantic tokens alone.
 */
export const RECIPES: Record<string, string[]> = {
  TopBar: ["component.top-bar", "component.icon-button"],
  SearchBar: ["component.input", "component.search"],
  Button: ["component.button"],
  IconButton: ["component.icon-button"],
  TextField: ["component.input"],
  ChipGroup: ["component.chip"],
  Tag: ["component.tag"],
  Card: ["component.card"],
  ListItem: ["component.list-item", "component.divider"],
  ServiceGrid: ["component.tile"],
  PromoBanner: ["component.banner", "component.button"],
  MapPlaceholder: ["component.media"],
  MediaPlaceholder: ["component.media"],
  Divider: ["component.divider"],
  BottomSheet: ["component.sheet"],
  BottomNav: ["component.nav-bar"],
  EmptyState: ["component.empty", "component.button"],
  InlineAlert: ["component.alert"],
  SegmentedControl: ["component.segmented"],
  Tabs: ["component.tabs"],
  Table: ["component.table", "component.tag"],
  Chart: ["component.chart"],
  Toolbar: ["component.segmented"],
  Player: ["component.media", "component.icon-button"],
  PropertyRow: ["component.input"],
  Panel: ["component.card"],
  Stepper: ["component.input", "component.search"],
};

/** Recipe groups that style these components (e.g. PromoBanner → banner and button). */
export function recipeGroupsFor(components: string[]): string[] {
  return [...new Set(components.flatMap((c) => RECIPES[c] ?? []))];
}

/** Every recipe group some catalog component is drawn with. */
export const STYLED_GROUPS = new Set(Object.values(RECIPES).flat());

/** Recipe token paths of a component, plus any the system's guide lists for it. */
export function recipePaths(component: string, allPaths: string[], guideTokens: string[] = []): string[] {
  const groups = RECIPES[component] ?? [];
  const inGroups = allPaths.filter((p) => groups.some((g) => p.startsWith(`${g}.`)));
  const extra = guideTokens.filter((p) => allPaths.includes(p) && !inGroups.includes(p));
  return [...inGroups, ...extra];
}
