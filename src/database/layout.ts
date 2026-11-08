import type { Dialect } from "./sql";

/*
 * How a team's database is laid out, as code read it with no tokens (pure): its tables, their columns
 * and types, keys, rounded row counts, an enum's labels, and the common values of a few short columns
 * that read as a status or a kind. Personal columns are marked by their names and never sampled;
 * a value that still looks personal is masked; free text is never sampled. Only the tables that
 * matter to a business's numbers go to Qalam AI, with the others' names, so it can ask about them.
 */

export type PersonalKind = "email" | "phone" | "name" | "address" | "location" | "network" | "secret" | "id-number" | "birth" | "card" | "free-text";

export interface LayoutColumn {
  name: string;
  /** As the database writes it: "integer", "character varying(32)", "order_status". */
  type: string;
  nullable: boolean;
  comment?: string;
  /** An enum's labels, in order. */
  labels?: string[];
  /** The common values, most common first, of a short status-like column (never a personal one). */
  values?: string[];
  personal?: PersonalKind;
  primary?: boolean;
  /** A foreign key: "schema.table.column". */
  ref?: string;
  /** Its type is a number. */
  numeric?: boolean;
}

export interface LayoutTable {
  schema: string;
  name: string;
  view?: boolean;
  /** The database's estimate; null when it has none. */
  rows: number | null;
  comment?: string;
  /** Row-level security hides some of its rows from the connected user. */
  hidden?: boolean;
  columns: LayoutColumn[];
}

export interface Layout {
  dialect: Dialect;
  /** The schema a table without one is in. */
  home: string;
  version?: string;
  at: number;
  tables: LayoutTable[];
}

export const tableKeyOf = (t: Pick<LayoutTable, "schema" | "name">) => `${t.schema}.${t.name}`;

/** Schemas of the database itself, and of platforms around it (Supabase's), never a team's own tables. */
export const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast", "auth", "storage", "realtime", "_realtime", "supabase_functions", "supabase_migrations", "extensions", "graphql", "graphql_public", "vault", "pgsodium", "pgsodium_masks", "net", "cron", "pgbouncer", "_analytics", "pgtle", "tiger", "topology", "mysql", "performance_schema", "sys"];

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Tables about people: on them a plain "name" is a person's. */
const PERSON_TABLES = /^(users?|customers?|clients?|members?|profiles?|accounts?|contacts?|people|persons?|employees?|staff|drivers?|couriers?|riders?|patients?|students?|leads?|subscribers?|guests?|passengers?|buyers?|sellers?|merchants?|vendors?|agents?)$/;

/** A column's personal kind, by its name (and its table's, for a plain "name"); null when it's not personal. */
export function personalOf(column: string, table: string): PersonalKind | null {
  const c = column.toLowerCase();
  const w = words(c);
  const has = (...xs: string[]) => xs.some((x) => w.includes(x));
  if (has("email", "mail") || c.includes("email")) return "email";
  if (has("phone", "mobile", "tel", "msisdn", "whatsapp", "telephone")) return "phone";
  if (has("password", "passwd", "secret", "token", "salt", "otp", "pin", "apikey", "hash") || /api_?key|access_?key|refresh_?token/.test(c)) return "secret";
  if (has("ssn", "passport", "nid") || /national_?id|tax_?id|id_?number|social_?security/.test(c)) return "id-number";
  if (has("dob", "birthday", "birthdate", "birth")) return "birth";
  if (has("iban", "cvv", "cvc", "pan") || /card_?(number|no)|account_?(number|no)|routing/.test(c)) return "card";
  if (has("ip", "useragent") || /ip_?address|user_?agent|mac_?address/.test(c)) return "network";
  if (has("latitude", "longitude", "lat", "lng", "lon", "geo", "coordinates", "location")) return "location";
  if (has("address", "street", "zip", "zipcode", "postcode", "postal")) return "address";
  if (/^(first|last|full|given|family|middle|display|legal|maiden)_?name$|^(surname|forename|fullname|firstname|lastname)$/.test(c)) return "name";
  if ((c === "name" || c === "names") && PERSON_TABLES.test(table.toLowerCase())) return "name";
  // Free text, by what the column is (a "review_status" is a status, not a review).
  if (/(^|_)(notes?|comments?|message|messages|body|bio|description|feedback|review|text|content|remarks|reply|answer)$/.test(c)) return "free-text";
  return null;
}

/** A column worth sampling for its common values: short text or an enum, named like a status or a kind, never personal. */
export function statusLike(c: Pick<LayoutColumn, "name" | "type" | "personal" | "primary" | "ref" | "labels">): boolean {
  if (c.personal || c.primary || c.ref) return false;
  const t = c.type.toLowerCase();
  const short = /^(text|character varying|varchar|char|character|citext|nvarchar|enum|set)\b/.test(t) && !/\((\d{3,})\)/.test(t);
  if (!short && !c.labels) return false;
  const w = words(c.name);
  const HINTS = ["status", "state", "type", "kind", "category", "channel", "method", "provider", "gateway", "currency", "plan", "tier", "stage", "source", "reason", "platform", "country", "region", "segment", "level", "mode", "period", "interval", "frequency", "outcome", "result", "role", "medium", "campaign", "grade", "class", "flag", "vertical", "market"];
  return !!c.labels || HINTS.some((h) => w.includes(h) || w.includes(`${h}s`));
}

/** A sampled value as it may be sent: short, and nothing that looks personal or like an id. */
export function maskValue(v: string): string | null {
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || s.length > 40) return null;
  if (/@/.test(s) || /\d[\d\s().-]{6,}\d/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^https?:\/\//i.test(s) || /\b\d{1,3}(\.\d{1,3}){3}\b/.test(s)) return null;
  return s;
}

const BUSINESS = ["order", "orders", "payment", "payments", "invoice", "invoices", "charge", "charges", "refund", "refunds", "transaction", "transactions", "subscription", "subscriptions", "plan", "plans", "customer", "customers", "user", "users", "account", "accounts", "product", "products", "item", "items", "line", "lines", "delivery", "deliveries", "shipment", "shipments", "cost", "costs", "fee", "fees", "expense", "expenses", "payout", "payouts", "revenue", "sale", "sales", "cart", "carts", "basket", "baskets", "coupon", "coupons", "discount", "discounts", "booking", "bookings", "reservation", "reservations", "trip", "trips", "ride", "rides", "store", "stores", "merchant", "merchants", "vendor", "vendors", "price", "prices", "tax", "taxes", "wallet", "wallets", "credit", "credits", "balance", "ledger", "commission", "commissions", "driver", "drivers", "courier", "couriers", "purchase", "purchases", "checkout", "checkouts", "seller", "sellers", "listing", "listings", "event", "events", "signup", "signups"];
const NOISE = /(^|_)(migrations?|schema_migrations|ar_internal_metadata|knex|flyway|prisma|sessions?|session_tokens?|tokens?|oauth|password_resets?|personal_access_tokens|failed_jobs|jobs|queue|cache|locks?|logs?|audit|telescope|webhook|spatial_ref_sys|geography_columns|geometry_columns)(_|$)/;

/** How much a table bears on a business's numbers: its name's business words, its links, its size; a table they named comes first. */
export function tableScore(t: LayoutTable, links: number, named: ReadonlySet<string>): number {
  const key = tableKeyOf(t).toLowerCase();
  if (named.has(key) || named.has(t.name.toLowerCase())) return 1000;
  if (NOISE.test(t.name.toLowerCase())) return -1;
  const w = words(t.name);
  const business = w.filter((x) => BUSINESS.includes(x)).length;
  const size = t.rows && t.rows > 0 ? Math.log10(t.rows + 1) : 0;
  return business * 3 + Math.min(links, 5) + size + (t.columns.some((c) => c.numeric) ? 1 : 0);
}

/** The tables that matter most, at most `max`, best first; the rest only by name. */
export function tablesThatMatter(l: Layout, o: { max?: number; named?: readonly string[] } = {}): { sent: LayoutTable[]; others: string[] } {
  const max = o.max ?? 25;
  const named = new Set((o.named ?? []).map((x) => x.toLowerCase()));
  const links = new Map<string, number>();
  for (const t of l.tables)
    for (const c of t.columns)
      if (c.ref) {
        const to = c.ref.split(".").slice(0, 2).join(".");
        links.set(tableKeyOf(t), (links.get(tableKeyOf(t)) ?? 0) + 1);
        links.set(to, (links.get(to) ?? 0) + 1);
      }
  const ranked = l.tables
    .map((t, i) => ({ t, i, s: tableScore(t, links.get(tableKeyOf(t)) ?? 0, named) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const sent = ranked.slice(0, max).map((x) => x.t);
  const sentKeys = new Set(sent.map(tableKeyOf));
  return { sent, others: l.tables.filter((t) => !sentKeys.has(tableKeyOf(t))).map(tableKeyOf).slice(0, 80) };
}

/** A row count as it's said: "about 300", "about 48 thousand", "about 1.2 million". */
export function aboutRows(n: number | null): string {
  if (n === null || n < 0) return "rows not counted";
  if (n < 1) return "empty";
  const round = (x: number) => (x >= 100 ? Math.round(x / 10) * 10 : x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
  if (n < 1000) return `about ${round(n)} rows`;
  if (n < 1e6) return `about ${round(n / 1000)} thousand rows`;
  if (n < 1e9) return `about ${round(n / 1e6)} million rows`;
  return `about ${round(n / 1e9)} billion rows`;
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const PERSONAL_WORD: Record<PersonalKind, string> = { email: "an email", phone: "a phone number", name: "a person's name", address: "an address", location: "a location", network: "a network address", secret: "a secret", "id-number": "an id number", birth: "a birth date", card: "card or bank details", "free-text": "free text" };

/** The layout as Qalam AI reads it: the tables that matter in full, the rest by name. Names are the database's; values only where sampled. */
export function layoutText(l: Layout, sent: readonly LayoutTable[], others: readonly string[]): string {
  const lines = [`The database: ${l.dialect === "mysql" ? "MySQL" : "Postgres"}${l.version ? ` (${clip(l.version, 40)})` : ""}. A table without a schema is in ${l.home}.`, ""];
  for (const t of sent) {
    lines.push(`- ${tableKeyOf(t)}${t.view ? " (a view)" : ""}, ${aboutRows(t.rows)}${t.comment ? `. Its comment: "${clip(t.comment, 160)}"` : ""}${t.hidden ? ". Row-level security hides some of its rows from this user, so a number reading it would fail" : ""}`);
    for (const c of t.columns.slice(0, 60)) {
      const bits = [`${c.name} ${clip(c.type, 40)}`];
      if (c.primary) bits.push("its key");
      if (c.ref) bits.push(`→ ${c.ref}`);
      if (c.nullable && !c.primary) bits.push("may be empty");
      if (c.labels?.length) bits.push(`one of: ${c.labels.slice(0, 30).map((x) => clip(x, 40)).join(", ")}`);
      else if (c.values?.length) bits.push(`values seen, most common first: ${c.values.join(", ")}`);
      if (c.personal) bits.push(`${PERSONAL_WORD[c.personal]}: Qalam never reads its values`);
      if (c.comment) bits.push(`its comment: "${clip(c.comment, 120)}"`);
      lines.push(`  ${bits.join("; ")}`);
    }
    if (t.columns.length > 60) lines.push(`  …and ${t.columns.length - 60} more columns`);
  }
  if (others.length) lines.push("", `Other tables, by name only: ${others.join(", ")}`);
  return lines.join("\n");
}

/** A Postgres array's text ({paid,refunded,"with space"}) as its items. */
export function pgArray(text: string): string[] {
  const s = text.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return [];
  const out: string[] = [];
  let i = 1;
  while (i < s.length - 1) {
    if (s[i] === ",") {
      i++;
      continue;
    }
    if (s[i] === '"') {
      let v = "";
      i++;
      while (i < s.length - 1 && s[i] !== '"') {
        if (s[i] === "\\") i++;
        v += s[i];
        i++;
      }
      out.push(v);
      i++;
      continue;
    }
    let j = i;
    while (j < s.length - 1 && s[j] !== ",") j++;
    const v = s.slice(i, j);
    if (v !== "NULL") out.push(v);
    i = j;
  }
  return out;
}

/** A name as a SQL string literal, for code's own catalog queries (names with a backslash or NUL are left out before this). */
export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** A name as a quoted identifier, in each dialect. */
export const ident = (s: string, d: Dialect) => (d === "mysql" ? `\`${s.replace(/`/g, "``")}\`` : `"${s.replace(/"/g, '""')}"`);
/** A name code can pass on safely in its own SQL. */
export const safeName = (s: string) => !!s && s.length <= 128 && !/[\\\u0000-\u001f]/.test(s);
