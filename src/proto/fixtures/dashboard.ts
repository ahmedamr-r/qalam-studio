import type { ScreenSpec } from "@/design-system/builders";
import { chooseOne, confirmFirst, tabPanels, toastAfter } from "../recipes";
import { fixture, text, type Fixture, type FixtureDef } from "./build";

/*
 * A workspace's settings in a web dashboard (a fixture): tabs switch between its sections; in
 * Billing a plan is picked and the upgrade button says which and for how much; deleting the
 * workspace asks first, then a toast says it's gone. The copy is fictional.
 */

/** The plans: name, what it allows, price a month. */
export const PLANS: [string, string, string][] = [
  ["Starter", "Up to 3 members", "$0.00"],
  ["Pro", "Up to 20 members", "$20.00"],
  ["Team", "Unlimited members", "$45.00"],
];

export const SETTINGS_SCREEN: ScreenSpec = {
  name: "Northwind · Workspace settings",
  platform: "dashboard",
  dir: "ltr",
  lang: "en",
  sidebar: [
    { component: "ListItem", props: { title: "Projects", leadingIcon: "folder" } },
    { component: "ListItem", props: { title: "Settings", leadingIcon: "settings" } },
  ],
  header: [text("Workspace settings", "title-lg")],
  body: [
    { component: "Tabs", props: { tabs: ["General", "Members", "Billing"], selected: 0 } },
    {
      component: "Card",
      props: { title: "General", tone: "surface" },
      children: [
        { component: "TextField", props: { label: "Workspace name", value: "Northwind" } },
        { component: "Button", props: { label: "Delete workspace", variant: "danger" } },
      ],
    },
    {
      component: "Card",
      props: { title: "Members", tone: "surface" },
      children: [
        { component: "ListItem", props: { title: "Sara Malik", subtitle: "Owner", avatar: "SM" } },
        { component: "ListItem", props: { title: "Omar Aziz", subtitle: "Editor", avatar: "OA" } },
      ],
    },
    {
      component: "Card",
      props: { title: "Billing", tone: "surface" },
      children: [
        ...PLANS.map(([title, subtitle, price], i) => ({ component: "ListItem", props: { title, subtitle, trailing: "radio", trailingText: price, checked: i === 1 } })),
        { component: "Button", props: { label: `Upgrade to ${PLANS[1][0]} · ${PLANS[1][2]}`, variant: "primary" } },
      ],
    },
  ],
};

export const DELETE_DIALOG: ScreenSpec = {
  name: "Delete workspace",
  platform: "dashboard",
  dir: "ltr",
  lang: "en",
  surface: "dialog",
  header: [text("Delete Northwind?", "title")],
  body: [text("Every project and file in it goes, for everyone. This can't be undone.", "body", "secondary")],
  footer: [
    { component: "Button", props: { label: "Delete workspace", variant: "danger", fullWidth: true } },
    { component: "Button", props: { label: "Cancel", variant: "secondary", fullWidth: true } },
  ],
};

export const DELETED_TOAST: ScreenSpec = { name: "Deleted", platform: "dashboard", dir: "ltr", lang: "en", surface: "toast", body: [text("Northwind was deleted", "body-strong")] };

/** The settings route: tab panels, choose one (a plan), confirm the delete first, then a toast. */
export const DASHBOARD: FixtureDef = {
  screen: SETTINGS_SCREEN,
  parts: { delete: DELETE_DIALOG, deleted: DELETED_TOAST },
  steps: [
    (_, f) => tabPanels(f.scan),
    (_, f) => chooseOne(f.scan, { name: "plan" }),
    (r, f) => confirmFirst(r, f.scan, f.scanOf("delete"), { part: "delete", action: f.scan.actions.find((a) => a.variant === "danger")!.path }),
    (r, f) => toastAfter(r, { part: "delete", path: f.scanOf("delete").primary!.path }, { part: "deleted" }),
  ],
};

export const dashboardFixture = (): Fixture => fixture(DASHBOARD);
