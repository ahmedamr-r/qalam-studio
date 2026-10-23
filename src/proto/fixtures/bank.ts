import type { ScreenSpec } from "@/design-system/builders";
import { chooseOne, confirmFirst, tabPanels, toastAfter } from "../recipes";
import { fixture, text, type Fixture, type FixtureDef } from "./build";

/*
 * Sending money (a fixture): to an account or a mobile number (tabs that switch what's asked
 * for), an amount picked from chips — the send button says how much — confirmed in a dialog that
 * repeats it, then a toast. The copy is fictional.
 */

export const AMOUNTS = ["AED 50", "AED 100", "AED 200", "AED 500"];

export const TRANSFER_SCREEN: ScreenSpec = {
  name: "Wallet · Send money",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  background: "canvas",
  header: [{ component: "TopBar", props: { title: "Send money", leading: "back" } }],
  body: [
    { component: "ListItem", props: { title: "Lina Haddad", subtitle: "Saved recipient", avatar: "LH" } },
    { component: "SegmentedControl", props: { options: ["Account", "Mobile"], selected: 0 } },
    { component: "Card", props: { title: "Account", tone: "surface" }, children: [{ component: "TextField", props: { label: "IBAN", value: "AE07 0331 2345 6789 0123 456" } }] },
    { component: "Card", props: { title: "Mobile", tone: "surface" }, children: [{ component: "TextField", props: { label: "Mobile number", value: "+971 50 123 4567" } }] },
    text("Amount", "body-strong"),
    { component: "ChipGroup", props: { chips: AMOUNTS, selected: 1 } },
    { component: "SummaryRow", props: { label: "Fee", value: "Free" } },
  ],
  footer: [{ component: "Button", props: { label: "Send AED 100.00", variant: "primary", fullWidth: true } }],
};

export const SEND_DIALOG: ScreenSpec = {
  name: "Confirm transfer",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  surface: "dialog",
  header: [text("Send AED 100.00 to Lina?", "title")],
  body: [text("It arrives in seconds, and a transfer can't be undone.", "body", "secondary")],
  footer: [
    { component: "Button", props: { label: "Send", variant: "primary", fullWidth: true } },
    { component: "Button", props: { label: "Cancel", variant: "tertiary", fullWidth: true } },
  ],
};

export const SENT_TOAST: ScreenSpec = { name: "Sent", platform: "mobile", dir: "ltr", lang: "en", surface: "toast", body: [text("Money sent to Lina", "body-strong")] };

/** The transfer route: tab panels, choose one (an amount), confirm first, then a toast. */
export const BANK: FixtureDef = {
  screen: TRANSFER_SCREEN,
  parts: { confirm: SEND_DIALOG, sent: SENT_TOAST },
  steps: [
    (_, f) => tabPanels(f.scan),
    (_, f) => chooseOne(f.scan, { name: "amount" }),
    (r, f) => confirmFirst(r, f.scan, f.scanOf("confirm"), { part: "confirm" }),
    (r, f) => toastAfter(r, { part: "confirm", path: f.scanOf("confirm").primary!.path }, { part: "sent" }),
  ],
};

export const bankFixture = (): Fixture => fixture(BANK);
