import { BANK } from "./bank";
import type { FixtureDef } from "./build";
import { DASHBOARD } from "./dashboard";
import { GROCERY } from "./grocery";
import { ORDERS } from "./orders";
import { RIDE } from "./ride";
import { SHOP } from "./shop";

/** The route fixtures by product kind (the menu is the demo's own, food-menu.ts). */
export const ROUTE_FIXTURES: Record<string, FixtureDef> = { ride: RIDE, bank: BANK, dashboard: DASHBOARD, shop: SHOP, grocery: GROCERY, orders: ORDERS };
