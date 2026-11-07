import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConnection, type Connection } from "@/database/connection";
import { OrgStore } from "../org/store";
import { resetSecrets } from "../secrets";
import { connectDatabase } from "./connect";
import { draftMetrics } from "./draft";
import { readLayout } from "./index";
import { readMysqlLayout } from "./mysql-layout";
import { openMysql } from "./mysql";
import { openPostgres } from "./postgres";
import { SAMPLE_SCHEMA } from "./testing/sample-schema";

/*
 * The database paths on real servers, opt-in: QALAM_DB_TEST=1, with a Postgres and a MySQL to reach.
 * PGlite can't show a server's own timeout or lock wait, and nothing in-process speaks MySQL, so
 * these run against Docker's official images, bound to this computer only:
 *
 *   docker run -d --name qalam-pg -e POSTGRES_PASSWORD=qalam -p 127.0.0.1:55432:5432 postgres:17
 *   docker run -d --name qalam-mysql -e MYSQL_ROOT_PASSWORD=qalam -p 127.0.0.1:53306:3306 mysql:8.4
 *   QALAM_DB_TEST=1 pnpm vitest run server/database/real.test.ts
 *
 * QALAM_DB_POSTGRES and QALAM_DB_MYSQL point elsewhere (an admin's string each). Each run makes its
 * own database and roles, and drops them after.
 */

const on = process.env.QALAM_DB_TEST === "1";
const PG_ADMIN = process.env.QALAM_DB_POSTGRES ?? "postgres://postgres:qalam@127.0.0.1:55432/postgres";
const MY_ADMIN = process.env.QALAM_DB_MYSQL ?? "mysql://root:qalam@127.0.0.1:53306/mysql";
process.env.QALAM_SECRETS = "memory";

const conn = (url: string) => {
  const c = parseConnection(url);
  if ("why" in c) throw new Error(c.why);
  return c as Connection;
};
const pgUrl = (user: string, db = "qalam_test") => {
  const u = new URL(PG_ADMIN);
  u.username = user;
  u.password = user === "postgres" ? decodeURIComponent(new URL(PG_ADMIN).password) : "qalam";
  u.pathname = `/${db}`;
  return u.toString();
};
const myUrl = (user: string) => {
  const u = new URL(MY_ADMIN);
  u.username = user;
  u.password = user === "root" ? decodeURIComponent(new URL(MY_ADMIN).password) : "qalam";
  u.pathname = "/qalam_shop";
  return u.toString();
};

describe.skipIf(!on)("Postgres, on a real server", () => {
  let admin: pg.Client;
  beforeAll(async () => {
    const root = new pg.Client({ connectionString: PG_ADMIN });
    await root.connect();
    await root.query("DROP DATABASE IF EXISTS qalam_test WITH (FORCE)");
    await root.query("DROP ROLE IF EXISTS reader, writer, member, editors");
    await root.query("CREATE DATABASE qalam_test");
    await root.end();
    admin = new pg.Client({ connectionString: pgUrl("postgres") });
    await admin.connect();
    await admin.query(SAMPLE_SCHEMA);
    await admin.query("ALTER ROLE reader PASSWORD 'qalam'; ALTER ROLE writer PASSWORD 'qalam'; ALTER ROLE member PASSWORD 'qalam'");
  }, 60_000);
  afterAll(async () => {
    await admin?.end().catch(() => {});
    const root = new pg.Client({ connectionString: PG_ADMIN });
    await root.connect().catch(() => {});
    await root.query("DROP DATABASE IF EXISTS qalam_test WITH (FORCE)").catch(() => {});
    await root.query("DROP ROLE IF EXISTS reader, writer, member, editors").catch(() => {});
    await root.end().catch(() => {});
  });

  it("is stopped by the database itself past its time, before the client's deadline", async () => {
    const r = await openPostgres({ conn: conn(pgUrl("reader")) });
    const started = Date.now();
    try {
      await expect(r.read("SELECT count(*) FROM generate_series(1, 1000000000)", { timeoutMs: 500 })).rejects.toMatchObject({ code: "57014", message: expect.stringMatching(/the database stopped it/) });
    } finally {
      await r.close();
    }
    expect(Date.now() - started).toBeLessThan(3000);
  }, 30_000);

  it("waits at most 2 seconds on a table a migration holds", async () => {
    const holder = new pg.Client({ connectionString: pgUrl("postgres") });
    await holder.connect();
    await holder.query("BEGIN; LOCK TABLE orders IN ACCESS EXCLUSIVE MODE");
    const r = await openPostgres({ conn: conn(pgUrl("reader")) });
    try {
      const started = Date.now();
      await expect(r.read("SELECT count(*) FROM orders")).rejects.toMatchObject({ code: "55P03", message: expect.stringMatching(/locked/) });
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await r.close();
      await holder.query("ROLLBACK").catch(() => {});
      await holder.end();
    }
  }, 30_000);

  it("says what each user may change", async () => {
    const rights = async (u: string) => {
      const r = await openPostgres({ conn: conn(pgUrl(u)) });
      try {
        return await r.rights();
      } finally {
        await r.close();
      }
    };
    expect(await rights("reader")).toMatchObject({ superuser: false, writesCount: 0, hidden: ["public.notes"] });
    expect((await rights("writer")).writes).toEqual(["public.orders"]);
    expect((await rights("member")).writes).toEqual(["public.refunds"]);
    expect(await rights("postgres")).toMatchObject({ superuser: true, hidden: [] });
  }, 30_000);

  it("refuses to reach it over TLS it doesn't offer, in words", async () => {
    await expect(openPostgres({ conn: conn(`${pgUrl("reader")}?sslmode=require`) })).rejects.toThrow(/doesn't take TLS/);
  }, 30_000);
});

describe.skipIf(!on)("MySQL, on a real server", () => {
  let admin: mysql.Connection;
  beforeAll(async () => {
    const u = new URL(MY_ADMIN);
    admin = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS qalam_shop; DROP USER IF EXISTS 'reader'@'%', 'writer'@'%', 'member'@'%'; DROP ROLE IF EXISTS 'editors';
CREATE DATABASE qalam_shop; USE qalam_shop;
CREATE TABLE customers (id BIGINT PRIMARY KEY, email VARCHAR(200) NOT NULL, full_name VARCHAR(200), plan VARCHAR(10) NOT NULL);
CREATE TABLE orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, status ENUM('pending','paid','refunded','cancelled') NOT NULL, total_cents INT NOT NULL, currency VARCHAR(3) NOT NULL, channel VARCHAR(10) NOT NULL, created_at DATETIME NOT NULL, deleted_at DATETIME NULL, FOREIGN KEY (customer_id) REFERENCES customers(id)) COMMENT 'One row per customer order';
CREATE TABLE refunds (id BIGINT PRIMARY KEY, order_id BIGINT NOT NULL, amount_cents INT NOT NULL, created_at DATETIME NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id));
INSERT INTO customers WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 40) SELECT n, CONCAT('c', n, '@example.com'), CONCAT('Customer ', n), IF(n % 3 = 0, 'plus', 'free') FROM g;
INSERT INTO orders WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 300) SELECT n, 1 + (n % 40), CASE WHEN n % 10 = 0 THEN 'refunded' WHEN n % 7 = 0 THEN 'cancelled' ELSE 'paid' END, 1000 + (n * 37) % 9000, 'EGP', IF(n % 3 = 0, 'web', 'app'), NOW() - INTERVAL (n % 60) DAY, NULL FROM g;
INSERT INTO refunds WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 30) SELECT n, n * 10, 500 + n, NOW() - INTERVAL (n % 30) DAY FROM g;
ANALYZE TABLE customers, orders, refunds;
CREATE USER 'reader'@'%' IDENTIFIED BY 'qalam'; GRANT SELECT, SHOW VIEW ON qalam_shop.* TO 'reader'@'%';
CREATE USER 'writer'@'%' IDENTIFIED BY 'qalam'; GRANT SELECT ON qalam_shop.* TO 'writer'@'%'; GRANT INSERT ON qalam_shop.orders TO 'writer'@'%';
CREATE ROLE 'editors'; GRANT UPDATE ON qalam_shop.refunds TO 'editors';
CREATE USER 'member'@'%' IDENTIFIED BY 'qalam'; GRANT SELECT ON qalam_shop.* TO 'member'@'%'; GRANT 'editors' TO 'member'@'%'; SET DEFAULT ROLE 'editors' TO 'member'@'%';`);
  }, 60_000);
  afterAll(async () => {
    await admin?.query("DROP DATABASE IF EXISTS qalam_shop; DROP USER IF EXISTS 'reader'@'%', 'writer'@'%', 'member'@'%'; DROP ROLE IF EXISTS 'editors';").catch(() => {});
    await admin?.end().catch(() => {});
  });

  it("says what each user may change, roles included", async () => {
    const rights = async (u: string) => {
      const r = await openMysql({ conn: conn(myUrl(u)) });
      try {
        return await r.rights();
      } finally {
        await r.close();
      }
    };
    expect(await rights("reader")).toMatchObject({ user: "reader", superuser: false, writesCount: 0 });
    expect((await rights("writer")).writes).toEqual(["qalam_shop.orders"]);
    expect((await rights("member")).writes).toEqual(["qalam_shop.refunds"]);
    expect((await rights("root")).superuser).toBe(true);
  }, 30_000);

  it("reads a number, typed as one, and runs one statement whatever the text says", async () => {
    const r = await openMysql({ conn: conn(myUrl("reader")) });
    try {
      const rows = await r.read("SELECT SUM(total_cents) / 100 AS total FROM qalam_shop.orders WHERE status = 'paid'");
      expect(rows.columns).toEqual([{ name: "total", numeric: true }]);
      expect(Number(rows.rows[0][0])).toBeGreaterThan(0);
      await expect(r.read("SELECT 1) q; DROP TABLE qalam_shop.orders; SELECT (1")).rejects.toBeTruthy();
    } finally {
      await r.close();
    }
    const [left] = await admin.query("SELECT COUNT(*) AS n FROM qalam_shop.orders");
    expect((left as { n: number }[])[0].n).toBe(300);
  }, 30_000);

  it("is stopped by the server past its time", async () => {
    const r = await openMysql({ conn: conn(myUrl("reader")) });
    const started = Date.now();
    try {
      await expect(r.read("SELECT COUNT(*) FROM information_schema.COLUMNS a, information_schema.COLUMNS b, information_schema.COLUMNS c", { timeoutMs: 500 })).rejects.toMatchObject({ message: expect.stringMatching(/stopped it/) });
    } finally {
      await r.close();
    }
    expect(Date.now() - started).toBeLessThan(6000);
  }, 30_000);

  it("gives the tables and columns a plan reads, and how the database is laid out", async () => {
    const r = await openMysql({ conn: conn(myUrl("reader")) });
    try {
      const plan = await r.explain("SELECT SUM(o.total_cents) FROM qalam_shop.orders o JOIN qalam_shop.refunds r ON r.order_id = o.id WHERE o.status = 'paid'");
      expect(plan.tables.sort()).toEqual(["qalam_shop.orders", "qalam_shop.refunds"]);
      expect(plan.columns).toEqual(expect.arrayContaining(["qalam_shop.orders.total_cents", "qalam_shop.orders.status"]));
      const l = await readMysqlLayout(r);
      const orders = l.tables.find((t) => t.name === "orders")!;
      expect(orders.comment).toBe("One row per customer order");
      expect(orders.columns.find((c) => c.name === "status")?.labels).toEqual(["pending", "paid", "refunded", "cancelled"]);
      expect(orders.columns.find((c) => c.name === "customer_id")?.ref).toBe("qalam_shop.customers.id");
      expect(orders.columns.find((c) => c.name === "channel")?.values?.sort()).toEqual(["app", "web"]);
      expect(l.tables.find((t) => t.name === "customers")!.columns.find((c) => c.name === "email")).toMatchObject({ personal: "email" });
      expect(l.tables.find((t) => t.name === "customers")!.columns.find((c) => c.name === "email")?.values).toBeUndefined();
    } finally {
      await r.close();
    }
  }, 30_000);

  it("connects, reads its layout, and checks a draft on it end to end", async () => {
    resetSecrets();
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-mysql-")), "Shop");
    const store = await OrgStore.create(dir, { id: "org1", name: "Shop", createdAt: 1 });
    try {
      expect(await connectDatabase(store, { url: myUrl("reader") })).toMatchObject({ state: "connected", local: { kind: "mysql", canWrite: false } });
      await readLayout(store);
      const structured = (async () => ({ data: { metrics: [{ name: "Revenue, last 30 days", means: "Money from paid orders in the last 30 days.", unit: "money", sql: "SELECT SUM(total_cents) / 100 FROM qalam_shop.orders WHERE status = 'paid' AND currency = 'EGP' AND deleted_at IS NULL AND created_at >= NOW() - INTERVAL 30 DAY", assumes: ["Amounts are in cents."], goal: "" }], cannot_tell: [] }, model: "stand-in" })) as never;
      const d = await draftMetrics(store, { structured });
      expect(d.drafts[0]).toMatchObject({ name: "Revenue, last 30 days", dialect: "mysql", error: undefined });
      expect(d.drafts[0].sample?.value).toBeGreaterThan(0);
      expect(d.drafts[0].reads).toEqual(expect.arrayContaining(["qalam_shop.orders.total_cents"]));
    } finally {
      store.dispose();
      await rm(path.dirname(dir), { recursive: true, force: true });
    }
  }, 60_000);
});
