import type { SeenText } from "./types";

/* A grocery app's screenshots as this Mac would read them (for tests). */

const line = (text: string, y: number, x = 0.1, w = 0.8, h = 0.03) => ({ text, box: [x, y, w, h] as [number, number, number, number], conf: 0.95 });
const nav = [line("Home", 0.94, 0.05, 0.15), line("Search", 0.94, 0.3, 0.15), line("Cart", 0.94, 0.55, 0.15), line("Account", 0.94, 0.78, 0.17)];

export const CART: SeenText = { w: 1179, h: 2556, dhash: "f0e0c0c08080c0e0", lines: [line("Your basket", 0.05), line("Bananas 1.2 kg", 0.2), line("Milk 2 L", 0.25), line("Total 24.50", 0.7), line("Apply coupon", 0.75), line("Checkout", 0.82), ...nav] };
export const CART_COUPON: SeenText = { w: 1179, h: 2556, dhash: "f0e0c0c08080c0e1", lines: [line("Your basket", 0.05), line("Bananas 1.2 kg", 0.2), line("Milk 2 L", 0.25), line("Coupon SAVE10 applied", 0.6), line("Total 22.05", 0.7), line("Checkout", 0.82), ...nav] };
export const CART_EMPTY: SeenText = { w: 1179, h: 2556, dhash: "0f0f1f3f7fffff00", lines: [line("Your basket is empty", 0.4), line("Start shopping", 0.5), ...nav] };
export const ADDRESS: SeenText = { w: 1179, h: 2556, dhash: "aa55aa55aa55aa55", lines: [line("Delivery address", 0.05), line("12 Nile Street, Cairo", 0.2), line("Change", 0.25), line("Continue to payment", 0.82)] };
export const SLOT: SeenText = { w: 1179, h: 2556, dhash: "3c3c3c3c3c3c3c3c", lines: [line("Pick a delivery slot", 0.05), line("Today", 0.15), line("Tomorrow", 0.15, 0.5), line("10:00 - 12:00", 0.3), line("Next", 0.82)] };
export const PAY: SeenText = { w: 1179, h: 2556, dhash: "ff00ff00ff00ff00", lines: [line("Payment", 0.05), line("Card ending 4242", 0.2), line("Pay 24.50", 0.82)] };
export const DONE: SeenText = { w: 1179, h: 2556, dhash: "00ff00ff00ff00ff", lines: [line("Order placed", 0.3), line("Arrives today 10:00 - 12:00", 0.4), line("Track order", 0.8)] };
export const ARABIC: SeenText = { w: 1179, h: 2556, dhash: "1234123412341234", lines: [line("سلة التسوق", 0.05), line("إتمام الطلب", 0.82)] };

export const ref = (n: number) => `asset:${String(n).padStart(24, "0")}`;
