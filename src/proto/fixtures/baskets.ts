import type { Inst, ScreenSpec } from "@/design-system/builders";
import { text } from "./build";

/*
 * Baskets: the page a basket bar opens, as Generate draws one from what the prototype carried —
 * its lines as rows, then what they come to. A food basket like the live one (rows with a picture,
 * a note and a stepper; a delivery fee), a fashion bag of list rows (euros written the continental
 * way, free shipping, no steppers), and an Arabic grocery basket, right to left, in riyals and
 * Arabic digits. The copy is fictional.
 */

const line = (title: string, note: string, amount: string, qty: number): Inst => ({
  component: "Stack",
  props: { direction: "horizontal", gap: "300", align: "center" },
  children: [
    { component: "Image", props: { alt: title, src: "", width: 64, aspect: "1:1", radius: "md" } },
    { component: "Stack", props: { direction: "vertical", gap: "100" }, children: [text(title, "body-strong"), text(note, "caption", "secondary"), text(amount, "label")] },
    { component: "Stepper", props: { value: qty } },
  ],
});

const divided = (rows: Inst[]): Inst[] => rows.flatMap((r, i) => [...(i ? [{ component: "Divider", props: {} } as Inst] : []), r]);

/** What Al Mallah's basket bar opens: two dishes, a delivery fee, the total. */
export const FOOD_BASKET: ScreenSpec = {
  name: "Basket · Al Mallah",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  header: [{ component: "TopBar", props: { title: "Basket", leading: "back" } }],
  body: [
    {
      component: "Card",
      props: { tone: "raised", padding: "400" },
      children: [
        { component: "ListItem", props: { title: "Al Mallah", subtitle: "Delivery in 25–35 min", trailing: "none" } },
        ...divided([line("Chicken Arabic platter", "Large · Garlic sauce", "AED 74.00", 2), line("Falafel wrap", "Regular", "AED 14.00", 1)]),
        { component: "Button", props: { label: "Add more items", variant: "tertiary", icon: "plus" } },
      ],
    },
    {
      component: "Card",
      props: { title: "Payment summary", tone: "raised", padding: "400" },
      children: [
        { component: "SummaryRow", props: { label: "Subtotal", value: "AED 88.00" } },
        { component: "SummaryRow", props: { label: "Delivery fee", value: "AED 5.00" } },
        { component: "Divider", props: {} },
        { component: "SummaryRow", props: { label: "Total", value: "AED 93.00", emphasis: true } },
      ],
    },
  ],
  footer: [{ component: "Button", props: { label: "Checkout · AED 93.00", variant: "primary", fullWidth: true } }],
};

/** What Linea's bag bar opens: list rows, shipping on the house. */
export const FASHION_BAG: ScreenSpec = {
  name: "Bag · Linea",
  platform: "mobile",
  dir: "ltr",
  lang: "en",
  header: [{ component: "TopBar", props: { title: "Bag", leading: "back" } }],
  body: [
    {
      component: "Card",
      props: { tone: "raised" },
      children: divided([
        { component: "ListItem", props: { title: "Linen shirt", subtitle: "Size M · Sand", trailing: "text", trailingText: "39,90 €" } },
        { component: "ListItem", props: { title: "Wide jeans", subtitle: "Size 32 · Mid blue", trailing: "text", trailingText: "69,90 €" } },
      ]),
    },
    {
      component: "Card",
      props: { tone: "raised" },
      children: [
        { component: "SummaryRow", props: { label: "Subtotal", value: "109,80 €" } },
        { component: "SummaryRow", props: { label: "Shipping", value: "Free" } },
        { component: "SummaryRow", props: { label: "Total", value: "109,80 €", emphasis: true } },
      ],
    },
  ],
  footer: [{ component: "Button", props: { label: "Checkout · 109,80 €", variant: "primary", fullWidth: true } }],
};

/** What the neighbourhood grocery's basket bar opens, right to left. */
export const GROCERY_BASKET: ScreenSpec = {
  name: "السلة · بقالة الحي",
  platform: "mobile",
  dir: "rtl",
  lang: "ar",
  header: [{ component: "TopBar", props: { title: "السلة", leading: "back" } }],
  body: [
    {
      component: "Card",
      props: { tone: "raised", padding: "400" },
      children: divided([line("تفاح أحمر", "كيس ٢ كغ", "٢٥٫٠٠ ر.س", 1), line("طماطم", "١ كغ", "١١٫٠٠ ر.س", 2)]),
    },
    {
      component: "Card",
      props: { tone: "raised", padding: "400" },
      children: [
        { component: "SummaryRow", props: { label: "المجموع الفرعي", value: "٣٦٫٠٠ ر.س" } },
        { component: "SummaryRow", props: { label: "رسوم التوصيل", value: "٥٫٠٠ ر.س" } },
        { component: "SummaryRow", props: { label: "الإجمالي", value: "٤١٫٠٠ ر.س", emphasis: true } },
      ],
    },
  ],
  footer: [{ component: "Button", props: { label: "إتمام الطلب · ٤١٫٠٠ ر.س", variant: "primary", fullWidth: true } }],
};
