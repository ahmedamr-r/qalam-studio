/**
 * Screen platforms: frame size, default side margin and the layout guidelines generated screens
 * follow. Phone screens take their side margins from the design system (layout.gutter, 16px in
 * the built-in one) unless the brief asks for something else; web, dashboard and desktop app
 * screens are 1440 wide with the platform's margins.
 */

export type Platform = "mobile" | "web" | "dashboard" | "app";

export const PLATFORM_IDS: Platform[] = ["mobile", "web", "dashboard", "app"];

export interface PlatformSpec {
  label: string;
  /** Frame width and minimum height. */
  w: number;
  h: number;
  /** Default side margin (px) when the brief doesn't ask for another. */
  margin: number;
  /** Largest side margin a brief can ask for. */
  maxMargin: number;
}

export const PLATFORMS: Record<Platform, PlatformSpec> = {
  mobile: { label: "Mobile", w: 390, h: 844, margin: 16, maxMargin: 48 },
  web: { label: "Web", w: 1440, h: 1024, margin: 120, maxMargin: 400 },
  dashboard: { label: "Dashboard", w: 1440, h: 1024, margin: 32, maxMargin: 64 },
  app: { label: "Desktop app", w: 1440, h: 900, margin: 16, maxMargin: 32 },
};

/** Dashboard side navigation width. */
export const SIDEBAR_W = 256;
/** Desktop app start panel (library, assets, layers) width. */
export const APP_PANEL_W = 280;

export const isPlatform = (v: unknown): v is Platform => typeof v === "string" && (PLATFORM_IDS as string[]).includes(v);

/**
 * Side margin for a screen: the brief's, if it asked for one (a number in the spec); otherwise the
 * design system's gutter on phones and the platform default on web and dashboards (a gutter
 * measured on a phone screenshot says nothing about a 1440-wide page).
 */
export function marginFor(platform: Platform, margin: unknown, systemGutter?: number): number {
  const p = PLATFORMS[platform];
  const clampM = (m: number) => Math.round(Math.max(0, Math.min(m, p.maxMargin)));
  if (typeof margin === "number" && Number.isFinite(margin)) return clampM(margin);
  if (platform === "mobile" && typeof systemGutter === "number" && Number.isFinite(systemGutter)) return clampM(systemGutter);
  return p.margin;
}

const MOBILE = /\b(mobile|phone|iphone|android|ios|app screen|smartphone)\b|جوال|هاتف|موبايل/i;
/** Tools people make or edit something in: editors, creative suites, IDEs, DAWs. */
const APP =
  /\b((video|photo|image|audio|sound|music|podcast|code|vector|motion|graphics?|3d|level|map) (editor|editing)|(editing|editor|creative|design|drawing|animation) (app|tool|software|suite|studio|workspace)|edit(s|ing)? (videos?|photos?|images?|audio|sound|music|podcasts?|clips|footage)|timeline editor|non-?linear|nle|daw|audio workstation|ide|whiteboard|desktop (app|application|software|tool)|creative (tool|suite)|premiere|final cut|davinci|after effects|capcut|photoshop|lightroom|ableton|logic pro|vs ?code)\b|محرر|مونتاج|تحرير (الفيديو|الصور|الصوت)/i;
const DASHBOARD = /\b(dashboards?|admin|analytics|back[- ]?office|console|cms|crm|portal|control panel|internal tools?)\b|لوحة تحكم|لوحة معلومات/i;
const WEB = /\b(web ?sites?|web ?pages?|web ?apps?|web ?applications?|landing pages?|desktop|browser|marketing (site|page)|saas|web)\b|موقع/i;

/** Words that turn a mention around: "not a dashboard", "don't make it look like a dashboard". */
const NEGATION = /\b(not|no(?!-)|never|without|avoid(ing)?|instead of|rather than|other than|except|unlike|nothing like|anything but|(is|are|do|does|should|would|wo|ca)n['’]?t)\b|(?:^|\s)(?:لا|ليس|ليست|بدون|غير|مش)(?=\s|$)/i;

/**
 * The brief asks for this: it mentions it somewhere that isn't negated. "A video editor, not a
 * dashboard" doesn't ask for a dashboard; the few words before each mention, within its clause,
 * decide.
 */
export function mentions(re: RegExp, brief: string): boolean {
  const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of brief.matchAll(all)) {
    const clause = brief.slice(0, m.index).split(/[.,;:!?\n،؛]|\s(?:but|-|–)\s/i).pop() ?? "";
    if (!NEGATION.test(clause.trim().split(/\s+/).slice(-5).join(" "))) return true;
  }
  return false;
}

/**
 * The platform a brief asks for. A phone mentioned anywhere wins ("a mobile dashboard for
 * drivers" is a phone screen); then tools people edit in (a video editor, a design tool), then
 * dashboards, then web, then mobile by default. Negated mentions ("not a dashboard") don't count.
 */
export function inferPlatform(brief: string): Platform {
  if (mentions(MOBILE, brief)) return "mobile";
  if (mentions(APP, brief)) return "app";
  if (mentions(DASHBOARD, brief)) return "dashboard";
  if (mentions(WEB, brief)) return "web";
  return "mobile";
}

/** Guidelines for the four platforms (stable, so it can sit in cached prompts). */
export const PLATFORM_GUIDE = `Platform guidelines. Every screen has a platform; follow the guidelines for it unless the brief explicitly asks for something else.

Mobile (390×844 phone; the studio adds the status bar and home indicator):
- Side margins come from the design system (layout.gutter): leave margin null unless the brief asks for other margins. Content lines up on those margins; don't add horizontal padding on top of them. Only maps, media and banners may run edge to edge.
- Single column. Touch targets at least 44×44. Horizontal Stacks hold at most 3 items (chips and tags excepted); a longer row of cards or media is a Carousel.
- header: one TopBar (back on child screens, none or menu on top-level screens). footer: the one primary Button, a BottomNav (3–5 tabs, top-level screens only) or a BottomSheet — the primary action sits in the thumb zone. sidebar: empty.
- hero (optional): lead content on the system's backdrop gradient, which also runs behind the status bar and TopBar (the TopBar turns transparent there). The body's first section can overlap its bottom edge (overlap). Empty on task screens.

Web (1440 wide, responsive website or web app page):
- Content sits in a centred 1200px column: leave margin null (the studio uses 120) unless the brief asks otherwise. Think in a 12-column grid with 24px gutters: rows of 2–4 Cards in horizontal Stacks, text blocks no wider than about 8 columns.
- header: the site navigation — brand name as a Text (title), a horizontal Stack of 3–5 link Texts, and one Button (the main call to action). Never a TopBar, BottomNav or BottomSheet.
- hero: on landing and marketing pages, the headline block (headline in display or title-lg, supporting body text, primary and secondary Buttons, a MediaPlaceholder beside it in a horizontal Stack) on the backdrop gradient, which also runs behind the navigation; a row of Cards in the body can overlap its edge. Empty on web app pages.
- body: sections stacked with generous spacing — feature rows, proof, and a closing call to action (with no hero, the headline block opens the body).
- footer: the page footer — horizontal Stack of link groups and a caption Text; not a pinned action. sidebar: empty.

Dashboard (1440 wide, data-dense web app or admin tool for monitoring and managing records; a tool where people create or edit something, such as an editor, is a desktop app, not a dashboard):
- sidebar: the left navigation (256px, added by the studio): brand name as a Text (headline), then 5–8 ListItems with a leadingIcon each; wrap the current page's ListItem in a Stack with background "brand-subtle" and radius "md".
- header: the page bar at the top of the main area — page title Text (title-lg) and a horizontal Stack of actions (a SearchBar, a secondary and at most one primary Button).
- body: leave margin null (the studio uses 32). First a horizontal Stack of 3–4 KPI Cards (label, big value in title-lg, change as a Tag), then two-column rows (horizontal Stacks of Cards) for charts (a Chart in a Card), tables (a Table in a Card) and activity feeds (Cards of ListItems with dividers). Every data group is a Card with a title. 24px between groups.
- footer: usually empty; a row of Buttons only for a pinned bulk action. Never a TopBar, BottomNav or BottomSheet.
- hero: always empty (no backdrop on dashboards), overlap "none".

Desktop app (1440×900 window of a tool people make or edit something in: a video, photo or audio editor, a design tool, an IDE; in a browser or native):
- The window is the workspace. No page sections, no centred column, no hero, no KPI Cards, Charts or Tables unless the tool shows data. Leave margin null (the studio uses 16 inside the workspace). Compact: Buttons size "sm" or "md", Stack gaps 100–300, captions and labels more than body text.
- header: the app bar across the top (the studio draws it 56px high with a bottom border): the app or project name as a Text (headline), a Toolbar of the tools people switch between (select, cut, text, crop…), and a horizontal Stack of actions on the end edge (at most one primary Button such as Export, the rest secondary or IconButtons). Never a TopBar, BottomNav or BottomSheet.
- sidebar: the start panel (280px, added by the studio) for what people pick from: media, assets, layers, files. Tabs to switch its views, a SearchBar only if it searches, then the items (horizontal Stacks of 2 MediaPlaceholders for media, ListItems for files or layers). Empty if the tool has no library.
- body: the workspace. The stage takes the space: a Player for video, a MediaPlaceholder for an image or a canvas. Beside it, a horizontal Stack puts an inspector Panel (240–360 wide) for the selected item: PropertyRows, Sliders, SegmentedControls, grouped under short captions. Put the stage first in that horizontal Stack.
- footer: the bottom panel across the full width: the Timeline for anything time-based (video, audio, animation) with a small row of timeline tools above it (a Toolbar or IconButtons and a zoom Slider), or a status bar (a horizontal Stack of caption Texts) otherwise.
- hero: always empty, overlap "none".`;
