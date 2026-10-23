import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { studio, useStudio } from "@/doc/store";
import { emptyDoc, type SceneNode } from "@/doc/schema";
import { release, useReservations } from "@/doc/reservations";
import { DEMO_SCREENS } from "@/ui/demo";
import { buildScreen, type Inst, type ScreenSpec } from "./builders";
import { APP_PANEL_W, inferPlatform, marginFor, PLATFORMS, SIDEBAR_W } from "./platform";
import { frameSize, insertScreens, nextSlot, reserveScreens } from "./place";

const build = (spec: ScreenSpec) => layoutToNodes(buildScreen(spec), { dir: "ltr", lang: "en" }, { x: 0, y: 0 });
const named = (ns: SceneNode[], name: string) => ns.find((n) => n.name === name)!;
const kids = (ns: SceneNode[], parent: SceneNode) => ns.filter((n) => n.parentId === parent.id);

describe("platforms", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("reads the platform from the brief, phone first", () => {
    expect(inferPlatform("Order tracking with a live map")).toBe("mobile");
    expect(inferPlatform("Landing page for Lumen Plus")).toBe("web");
    expect(inferPlatform("Fleet analytics dashboard for city managers")).toBe("dashboard");
    expect(inferPlatform("Admin console for restaurant partners")).toBe("dashboard");
    expect(inferPlatform("A mobile dashboard for captains")).toBe("mobile");
    expect(inferPlatform("لوحة تحكم للمطاعم")).toBe("dashboard");
  });

  it("ignores what the brief rules out", () => {
    expect(inferPlatform("A web app that looks like a video editor, don't generate a dashboard")).toBe("app");
    expect(inferPlatform("Video editor web app. Not a dashboard!")).toBe("app");
    expect(inferPlatform("A web app for editing videos, nothing like a dashboard")).toBe("app");
    expect(inferPlatform("Pricing web page, not a dashboard")).toBe("web");
    expect(inferPlatform("Onboarding without an admin console")).toBe("mobile");
    expect(inferPlatform("A dashboard with no charts")).toBe("dashboard");
    expect(inferPlatform("no-code dashboard builder")).toBe("dashboard");
    expect(inferPlatform("لا أريد لوحة تحكم، أريد محرر فيديو")).toBe("app");
  });

  it("reads tools people edit in as desktop apps", () => {
    expect(inferPlatform("A photo editing tool in the browser")).toBe("app");
    expect(inferPlatform("Something like CapCut on the web")).toBe("app");
    expect(inferPlatform("Podcast editor with a multitrack timeline")).toBe("app");
    expect(inferPlatform("Edit profile screen")).toBe("mobile");
    expect(inferPlatform("A mobile video editor")).toBe("mobile");
  });

  it("uses the platform's margin unless the brief set one, within limits", () => {
    expect(marginFor("mobile", undefined)).toBe(16);
    expect(marginFor("mobile", 24)).toBe(24);
    expect(marginFor("mobile", 400)).toBe(PLATFORMS.mobile.maxMargin);
    expect(marginFor("web", undefined)).toBe(120);
    expect(marginFor("dashboard", undefined)).toBe(32);
  });

  it("uses the system's gutter on phones when the brief didn't set a margin", () => {
    expect(marginFor("mobile", null, 20)).toBe(20);
    expect(marginFor("mobile", undefined, 24)).toBe(24);
    expect(marginFor("mobile", 12, 24)).toBe(12);
    expect(marginFor("mobile", null, 400)).toBe(PLATFORMS.mobile.maxMargin);
    // A phone gutter says nothing about a 1440-wide page.
    expect(marginFor("web", null, 20)).toBe(120);
    expect(marginFor("dashboard", null, 20)).toBe(32);
  });

  it("keeps phone screens at 390 with 16px side margins", () => {
    const ns = build(DEMO_SCREENS[0]);
    expect(ns[0].w).toBe(390);
    expect(named(ns, "Status bar")).toBeTruthy();
    const first = kids(ns, named(ns, "Content")).find((n) => n.meta.component !== "Map")!;
    expect(first.x).toBe(16);
  });

  const hero: ScreenSpec = {
    name: "Lumen Plus · Landing",
    platform: "web",
    header: [
      { component: "Text", props: { text: "Lumen", style: "title" } },
      { component: "Stack", props: { direction: "horizontal", gap: "600" }, children: [{ component: "Text", props: { text: "Rides" } }, { component: "Text", props: { text: "Food" } }] },
      { component: "Button", props: { label: "Get the app", variant: "primary" } },
    ],
    body: [
      {
        component: "Stack",
        props: { direction: "horizontal", gap: "600" },
        children: [
          { component: "Stack", props: { gap: "400" }, children: [{ component: "Text", props: { text: "One app for everything", style: "display" } }] },
          { component: "Stack", props: { gap: "400" }, children: [{ component: "MediaPlaceholder", props: { height: 320, icon: "car" } }] },
        ],
      },
    ],
    footer: [{ component: "Text", props: { text: "© Lumen", style: "caption" } }],
  };

  it("builds web pages 1440 wide in a 1200px column, with equal grid columns", () => {
    const ns = build(hero);
    expect(ns[0].w).toBe(1440);
    expect(ns.some((n) => n.name === "Status bar")).toBe(false);
    const content = named(ns, "Content");
    const row = kids(ns, content)[0];
    expect(row.x).toBe(120);
    expect(row.w).toBe(1200);
    const [left, right] = kids(ns, row);
    expect(left.w).toBe(right.w);
    expect(named(ns, "Navigation").h).toBe(72);
  });

  it("lays out web navigation as brand, links and call to action, however it was grouped", () => {
    const link = (text: string) => ({ component: "Text", props: { text } });
    const ns = build({
      name: "Nav",
      platform: "web",
      header: [
        {
          component: "Stack",
          props: { direction: "horizontal", justify: "between" },
          children: [{ component: "Text", props: { text: "Lumen Plus", style: "title" } }, link("Benefits"), link("Pricing"), link("FAQ"), { component: "Button", props: { label: "Join Plus" } }],
        },
      ],
      body: [],
    });
    const nav = named(ns, "Navigation");
    const [brand, links, cta] = kids(ns, nav);
    expect(brand.x).toBe(120);
    expect(links.name).toBe("Links");
    expect(kids(ns, links)).toHaveLength(3);
    expect(Math.round(cta.x + cta.w)).toBe(1440 - 120);
  });

  it("builds dashboards with a side navigation and 32px content margins", () => {
    const ns = build({
      name: "Fleet overview",
      platform: "dashboard",
      sidebar: [{ component: "ListItem", props: { title: "Overview", leadingIcon: "home" } }],
      header: [{ component: "Text", props: { text: "Fleet overview", style: "title-lg" } }],
      body: [{ component: "Card", props: { title: "Active trips" }, children: [{ component: "Text", props: { text: "1,284", style: "title-lg" } }] }],
    });
    expect(ns[0].w).toBe(1440);
    const sidebar = named(ns, "Sidebar");
    expect(sidebar.w).toBe(SIDEBAR_W);
    const main = named(ns, "Main");
    expect(main.x).toBe(SIDEBAR_W);
    expect(main.w).toBe(1440 - SIDEBAR_W);
    expect(kids(ns, named(ns, "Content"))[0].x).toBe(32);
  });

  it("builds desktop apps as an app bar, a start panel beside the stage, and a bottom panel across the window", () => {
    const ns = build(editorSpec());
    const root = ns[0];
    expect([root.w, root.h]).toEqual([1440, 900]);
    const bar = named(ns, "App bar");
    expect([bar.y, bar.h, bar.w]).toEqual([0, 56, 1440]);
    expect(named(ns, "Workspace").y).toBe(56);
    const panel = named(ns, "Start panel");
    expect([panel.x, panel.y, panel.w]).toEqual([0, 0, APP_PANEL_W]);
    const stage = named(ns, "Stage");
    expect(stage.x).toBe(APP_PANEL_W);
    expect(stage.w).toBe(1440 - APP_PANEL_W);
    const bottom = named(ns, "Bottom panel");
    expect(bottom.w).toBe(1440);
    expect(Math.round(bottom.y + bottom.h)).toBe(900);
    // The stage takes what the inspector leaves.
    const player = ns.find((n) => n.meta.component === "Player")!;
    const inspector = ns.find((n) => n.meta.component === "Panel")!;
    expect(inspector.w).toBe(300);
    expect(Math.round(player.w + 16 + inspector.w)).toBe(1440 - APP_PANEL_W - 32);
    expect(ns.some((n) => n.name === "Status bar" || n.name === "Backdrop")).toBe(false);
  });

  it("places Timeline clips and the playhead by time", () => {
    const ns = build(editorSpec());
    const lanes = named(ns, "Lanes");
    const clips = ns.filter((n) => n.name.startsWith("Clip/"));
    const byName = (name: string) => clips.find((c) => c.name === `Clip/${name}`)!;
    const wide = byName("Harbour wide");
    const close = byName("Dhow close-up");
    // 38s and 33s of a 150s project.
    expect(wide.x).toBe(0);
    expect(wide.w / lanes.w).toBeCloseTo(38 / 150, 2);
    expect(close.x / lanes.w).toBeCloseTo(38 / 150, 2);
    expect(close.w / lanes.w).toBeCloseTo(33 / 150, 2);
    const playhead = named(ns, "Playhead");
    expect([playhead.w, playhead.h]).toEqual([lanes.w, lanes.h]);
    const head = kids(ns, playhead).find((n) => n.name === "Head")!;
    expect((head.x + head.w / 2) / lanes.w).toBeCloseTo(42 / 150, 2);
  });

  it("spreads app bars and dashboard headers across the full width, however they were grouped", () => {
    const icon = (icon: string, label: string) => ({ component: "IconButton", props: { icon, label } });
    // The model often wraps the whole bar in one horizontal Stack, sometimes with its own fill.
    const wrapped = (children: Inst[]): Inst[] => [{ component: "Stack", props: { direction: "horizontal", gap: "200", align: "center", background: "raised", radius: "lg", padding: "200" }, children }];
    const app = build({
      name: "DAW · Beat maker",
      platform: "app",
      header: wrapped([
        { component: "Text", props: { text: "Night Drive · Drums B", style: "headline" } },
        { component: "Toolbar", props: { tools: [{ icon: "mouse-pointer-2", label: "Select" }, { icon: "pencil", label: "Draw" }, { icon: "scissors", label: "Split" }], selected: 0 } },
        { component: "Text", props: { text: "140 BPM · F minor · Bar 25.3", style: "caption" } },
        icon("square", "Stop"),
        icon("play", "Play"),
        icon("circle", "Record"),
        { component: "Button", props: { label: "Export", variant: "primary" } },
      ]),
      body: [],
    });
    const bar = named(app, "App bar");
    const [start, middle, end] = kids(app, bar).filter((n) => n.name !== "Border");
    expect(start.x).toBe(16);
    expect(kids(app, middle).some((n) => n.meta.component === "Toolbar")).toBe(true);
    // The actions end on the bar's end edge, and the bar keeps one surface (no box inside it).
    expect(Math.round(end.x + end.w)).toBe(1440 - 16);
    expect(kids(app, end).some((n) => n.meta.component?.startsWith("Button/"))).toBe(true);
    expect(app.some((n) => n.meta.component === "Stack" && n.parentId === bar.id)).toBe(false);

    // Or as groups (start, middle, end) inside that Stack: each keeps its own width, none spills past the end edge.
    const row = (children: Inst[]): Inst => ({ component: "Stack", props: { direction: "horizontal", gap: "300", align: "center" }, children });
    const grouped = build({
      name: "DAW · Grid first",
      platform: "app",
      header: [
        {
          component: "Stack",
          props: { direction: "horizontal", justify: "between", align: "center" },
          children: [
            row([{ component: "Text", props: { text: "Night Drive", style: "headline" } }, { component: "Toolbar", props: { tools: [{ icon: "pencil", label: "Draw" }], selected: 0 } }]),
            row([icon("skip-back", "Back to start"), icon("play", "Play"), icon("circle", "Record")]),
            row([
              { component: "PropertyRow", props: { label: "Tempo", kind: "stepper", value: "140" } },
              { component: "PropertyRow", props: { label: "Key", kind: "select", value: "F minor" } },
              { component: "Button", props: { label: "Export", variant: "primary" } },
            ]),
          ],
        },
      ],
      body: [],
    });
    const gBar = named(grouped, "App bar");
    const groups = kids(grouped, gBar).filter((n) => n.name !== "Border");
    expect(groups).toHaveLength(3);
    expect(groups[0].x).toBe(16);
    expect(Math.round(groups[2].x + groups[2].w)).toBe(1440 - 16);
    for (const g of groups) expect(Math.max(...kids(grouped, g).map((k) => Math.round(k.x + k.w)))).toBeLessThanOrEqual(Math.round(g.w));
    expect(groups[0].x + groups[0].w).toBeLessThan(groups[1].x);
    expect(groups[1].x + groups[1].w).toBeLessThan(groups[2].x);

    const dash = build({
      name: "Fleet overview",
      platform: "dashboard",
      header: wrapped([
        { component: "Text", props: { text: "Fleet overview", style: "title-lg" } },
        { component: "SearchBar", props: { placeholder: "Search vehicles" } },
        { component: "Button", props: { label: "Export", variant: "secondary" } },
        { component: "Button", props: { label: "Dispatch", variant: "primary" } },
      ]),
      body: [],
    });
    const head = named(dash, "Page header");
    const [title, actions] = kids(dash, head).filter((n) => n.name !== "Border");
    expect(title.x).toBe(32);
    expect(Math.round(actions.x + actions.w)).toBe(head.w - 32);
    expect(kids(dash, actions).map((n) => n.meta.component?.split("/")[0])).toEqual(["SearchBar", "Button", "Button"]);
  });

  it("keeps fill-width controls in dashboard headers at a natural width", () => {
    const ns = build({
      name: "Live operations",
      platform: "dashboard",
      header: [
        { component: "Text", props: { text: "Live operations", style: "title-lg" } },
        {
          component: "Stack",
          props: { direction: "horizontal", gap: "200", align: "center" },
          children: [
            { component: "SearchBar", props: { placeholder: "Search vehicles" } },
            { component: "SegmentedControl", props: { options: ["All", "Downtown", "Marina"], selected: 0 } },
            { component: "Button", props: { label: "Dispatch", variant: "primary", fullWidth: true } },
          ],
        },
      ],
      body: [],
    });
    const search = ns.find((n) => n.meta.component === "SearchBar")!;
    expect(search.w).toBe(320);
    const segments = ns.filter((n) => n.name.startsWith("Segment/"));
    expect(segments.every((s) => s.w > 80)).toBe(true);
    expect(ns.find((n) => n.meta.component?.startsWith("Button/"))!.w).toBeGreaterThan(60);
  });
});

describe("space held for AI work", () => {
  beforeAll(async () => {
    await ensureYoga();
  });
  beforeEach(() => {
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] });
    useReservations.setState({ list: [] });
  });

  it("reserves frames side by side and keeps later placements clear of them", async () => {
    const slot = reserveScreens("Generating", [frameSize("mobile"), frameSize("mobile"), frameSize("mobile")]);
    expect(useReservations.getState().list[0].boxes.map((b) => b.x)).toEqual([0, 470, 940]);
    expect(slot.bounds).toMatchObject({ x: 0, w: 390 * 3 + 160 });
    expect(nextSlot().x).toBe(slot.bounds.w + 160);
    release(slot.id);
    const ids = await insertScreens([DEMO_SCREENS[0], webSpec()], "ai", undefined, slot.at);
    const doc = studio().doc;
    expect(ids.map((id) => doc.nodes[id].x)).toEqual([0, 470]);
    expect(useReservations.getState().list).toEqual([]);
  });
});

function webSpec(): ScreenSpec {
  return { name: "Web", platform: "web", body: [{ component: "Text", props: { text: "Hello", style: "display" } }] };
}

function editorSpec(): ScreenSpec {
  return {
    name: "Reel · Edit",
    platform: "app",
    header: [
      { component: "Text", props: { text: "Harbour promo", style: "headline" } },
      { component: "Toolbar", props: { tools: [{ icon: "mouse-pointer-2", label: "Select" }, { icon: "scissors", label: "Split" }, { icon: "type", label: "Text" }], selected: 0 } },
      { component: "Button", props: { label: "Export", size: "sm" } },
    ],
    sidebar: [{ component: "Tabs", props: { tabs: ["Media", "Audio", "Text"], selected: 0 } }],
    body: [
      {
        component: "Stack",
        props: { direction: "horizontal", gap: "400" },
        children: [
          { component: "Player", props: { label: "Shot 2 · Dhow close-up", current: "00:42", duration: "02:30", progress: 28, height: 320 } },
          { component: "Panel", props: { title: "Clip", width: 300 }, children: [{ component: "Slider", props: { label: "Speed", value: 50, valueText: "1.0×" } }] },
        ],
      },
    ],
    footer: [
      {
        component: "Timeline",
        props: {
          duration: 150,
          playhead: 42,
          tracks: [
            { label: "V1", kind: "video", clips: [{ label: "Harbour wide", start: 0, end: 38 }, { label: "Dhow close-up", start: 38, end: 71, selected: true }] },
            { label: "Music", kind: "audio", clips: [{ label: "Oud theme", start: 0, end: 132 }] },
          ],
        },
      },
    ],
  };
}
