import type { Inst, ScreenSpec } from "@/design-system/builders";
import { collectionBar, configureAndAdd, headerOnScroll, stickySections } from "../recipes";
import { fixture, text, type Fixture, type FixtureDef } from "./build";

/*
 * A neighbourhood grocery in Arabic, right to left (a fixture): category chips over sections of
 * produce, each with a + that opens a sheet — a pack size that may cost more, paper packaging,
 * a quantity — then a basket bar. Prices are riyals in Arabic digits ("١٢٫٥٠ ر.س"), so totals
 * must be written back the same way. The copy is fictional.
 */

const item = (title: string, caption: string, price: string): Inst => ({
  component: "Stack",
  props: { direction: "horizontal", gap: "300", align: "center", justify: "between" },
  children: [
    { component: "Stack", props: { direction: "vertical", gap: "100" }, children: [text(title, "body-strong"), text(caption, "caption", "secondary"), text(price, "body-strong")] },
    { component: "IconButton", props: { icon: "plus", label: `أضف ${title}`.slice(0, 24), variant: "outline" } },
  ],
});

const section = (title: string, items: [string, string, string][]): Inst => ({
  component: "Card",
  props: { title, tone: "raised" },
  children: items.flatMap((it, i) => [...(i ? [{ component: "Divider", props: {} } as Inst] : []), item(...it)]),
});

/** The produce, by section: name, what it is, price. */
export const PRODUCE: Record<string, [string, string, string][]> = {
  فواكه: [
    ["تفاح أحمر", "من إيطاليا، كيس ١ كغ", "١٢٫٥٠ ر.س"],
    ["موز", "من الإكوادور، ١ كغ", "٧٫٢٥ ر.س"],
    ["عنب أخضر", "بدون بذور، ٥٠٠ غ", "١٤٫٠٠ ر.س"],
  ],
  خضار: [
    ["طماطم", "محلية، ١ كغ", "٥٫٥٠ ر.س"],
    ["خيار", "محلي، ٥٠٠ غ", "٤٫٠٠ ر.س"],
    ["فلفل ملون", "ثلاث حبات", "٩٫٧٥ ر.س"],
  ],
  أعشاب: [
    ["نعناع", "حزمة طازجة", "٢٫٥٠ ر.س"],
    ["بقدونس", "حزمة طازجة", "٢٫٠٠ ر.س"],
    ["كزبرة", "حزمة طازجة", "٢٫٠٠ ر.س"],
  ],
};

const ar = { platform: "mobile", dir: "rtl", lang: "ar" } as const;

export const GROCERY_SCREEN: ScreenSpec = {
  ...ar,
  name: "بقالة الحي · الفواكه والخضار",
  background: "canvas",
  header: [{ component: "TopBar", props: { title: "الفواكه والخضار", leading: "back", trailing: "search" } }],
  body: [{ component: "ChipGroup", props: { chips: Object.keys(PRODUCE), selected: 0 } }, ...Object.entries(PRODUCE).map(([title, items]) => section(title, items))],
};

export const ITEM_SHEET: ScreenSpec = {
  ...ar,
  name: "خيارات المنتج",
  surface: "sheet",
  header: [{ component: "TopBar", props: { title: "تفاح أحمر", leading: "close" } }],
  body: [
    text("من إيطاليا، كيس ١ كغ", "body", "secondary"),
    {
      component: "Card",
      props: { title: "الحجم · مطلوب", tone: "surface" },
      children: [
        { component: "ListItem", props: { title: "كيس عادي", trailing: "radio", checked: true } },
        { component: "ListItem", props: { title: "كيس عائلي", trailing: "radio", trailingText: "+٨٫٠٠ ر.س", checked: false } },
      ],
    },
    {
      component: "Card",
      props: { title: "إضافات", tone: "surface" },
      children: [{ component: "ListItem", props: { title: "تغليف ورقي", trailing: "checkbox", trailingText: "+١٫٠٠ ر.س", checked: false } }],
    },
  ],
  footer: [
    {
      component: "Stack",
      props: { direction: "horizontal", gap: "300", align: "center" },
      children: [
        { component: "Stepper", props: { value: 1 } },
        { component: "Button", props: { label: "أضف · ١٢٫٥٠ ر.س", variant: "primary", fullWidth: true } },
      ],
    },
  ],
};

export const GROCERY_BAR: ScreenSpec = {
  ...ar,
  name: "شريط السلة",
  surface: "bar",
  body: [{ component: "Button", props: { label: "عرض السلة · ١٢٫٥٠ ر.س", variant: "primary", icon: "shopping-basket", fullWidth: true } }],
};

/** The grocery route: the menu's recipes, in Arabic and right to left. */
export const GROCERY: FixtureDef = {
  screen: GROCERY_SCREEN,
  parts: { options: ITEM_SHEET, basket: GROCERY_BAR },
  steps: [
    (_, f) => headerOnScroll(f.scan),
    (_, f) => stickySections(f.scan),
    (_, f) => configureAndAdd(f.scan, f.scanOf("options"), { part: "options" }),
    (_, f) => collectionBar(f.scan, f.scanOf("basket"), { part: "basket" }),
  ],
};

export const groceryFixture = (): Fixture => fixture(GROCERY);
