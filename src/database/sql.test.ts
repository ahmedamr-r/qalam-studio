import { describe, expect, it } from "vitest";
import { guardSql, wrapped, type Dialect } from "./sql";

const ok = (sql: string, d: Dialect = "postgres") => {
  const g = guardSql(sql, d);
  if (!g.ok) throw new Error(`refused: ${g.why}\n${sql}`);
  return g;
};
const refused = (sql: string, d: Dialect = "postgres") => {
  const g = guardSql(sql, d);
  if (g.ok) throw new Error(`passed:\n${sql}`);
  return g.why;
};

describe("the guard on a metric's query: what a read looks like", () => {
  it("takes a plain aggregate and names the tables it reads", () => {
    const g = ok("SELECT sum(total_cents) / 100.0 FROM orders WHERE status = 'paid' AND created_at >= now() - interval '30 days'");
    expect(g.tables).toEqual([{ name: "orders" }]);
    expect(g.functions.sort()).toEqual(["now", "sum"]);
  });

  it("reads joins, schemas, comma lists and a subquery's own tables", () => {
    expect(ok("SELECT count(*) FROM public.orders o JOIN public.customers AS c ON c.id = o.customer_id").tables).toEqual([
      { schema: "public", name: "orders", alias: "o" },
      { schema: "public", name: "customers", alias: "c" },
    ]);
    expect(ok("SELECT count(*) FROM orders o, refunds r WHERE r.order_id = o.id").tables).toEqual([
      { name: "orders", alias: "o" },
      { name: "refunds", alias: "r" },
    ]);
    // A keyword after a table isn't its alias.
    expect(ok("SELECT count(*) FROM orders WHERE status = 'paid'").tables).toEqual([{ name: "orders" }]);
    expect(ok("SELECT count(*) FROM (SELECT id FROM orders) s, refunds r").tables.map((t) => t.name).sort()).toEqual(["orders", "refunds"]);
    expect(ok("SELECT count(*) FROM orders o LEFT JOIN LATERAL (SELECT 1 FROM refunds r WHERE r.order_id = o.id LIMIT 1) x ON true").tables.map((t) => t.name)).toEqual(["orders", "refunds"]);
    expect(ok("SELECT COUNT(*) FROM shop.orders o JOIN shop.refunds r ON r.order_id = o.id", "mysql").tables).toEqual([
      { schema: "shop", name: "orders", alias: "o" },
      { schema: "shop", name: "refunds", alias: "r" },
    ]);
  });

  it("leaves its own CTE names out of the tables", () => {
    const g = ok("WITH paid AS (SELECT * FROM orders WHERE status = 'paid'), big AS (SELECT * FROM paid WHERE total > 100) SELECT count(*) FROM big");
    expect(g.tables).toEqual([{ name: "orders" }]);
    expect(ok("WITH RECURSIVE n(i) AS (SELECT 1 FROM orders UNION ALL SELECT i + 1 FROM n WHERE i < 3) SELECT count(*) FROM n").tables).toEqual([{ name: "orders" }]);
  });

  it("doesn't take FROM inside EXTRACT, SUBSTRING or TRIM for a table", () => {
    expect(ok("SELECT extract(epoch FROM avg(delivered_at - created_at)) / 60 FROM deliveries").tables).toEqual([{ name: "deliveries" }]);
    expect(ok("SELECT count(*) FROM orders WHERE substring(code FROM 1 FOR 2) = 'EG'").tables).toEqual([{ name: "orders" }]);
  });

  it("takes casts, FILTER, windows and quoted names, keeping a quoted name's case", () => {
    ok("SELECT count(*) FILTER (WHERE status = 'refunded')::numeric / nullif(count(*), 0) FROM orders");
    ok("SELECT sum(total)::numeric(12, 2) FROM orders");
    ok("SELECT CAST(sum(total) AS decimal(12, 2)) FROM orders");
    ok("SELECT avg(n) FROM (SELECT customer_id, count(*) OVER (PARTITION BY customer_id) AS n FROM orders) x");
    expect(ok(`SELECT count(*) FROM "Orders" WHERE "comment" IS NOT NULL`).tables).toEqual([{ name: "Orders" }]);
  });

  it("takes its comments out and one trailing semicolon, so wrapping it can't be swallowed by a comment", () => {
    const g = ok("SELECT count(*) FROM orders -- every one\n/* even old ones */;");
    expect(g.sql).not.toMatch(/--|\/\*|;/);
    expect(wrapped(g.sql, 2)).toMatch(/^SELECT \* FROM \(\nSELECT count\(\*\) FROM orders\s*\n\) AS qalam_q LIMIT 2$/);
    // Postgres nests block comments.
    expect(ok("SELECT 1 /* a /* b */ c */ FROM orders").sql).not.toMatch(/\/\*/);
  });
});

describe("the guard: what isn't a read", () => {
  it("refuses anything that isn't one SELECT or WITH", () => {
    expect(refused("DELETE FROM orders")).toMatch(/doesn't start with SELECT/);
    expect(refused("COPY (SELECT 1) TO PROGRAM 'curl x'")).toMatch(/doesn't start with SELECT/);
    expect(refused("SELECT 1 FROM orders; DROP TABLE orders")).toMatch(/more than one statement/);
    expect(refused("select 1")).toMatch(/reads no table/);
    expect(refused("   ")).toMatch(/no query/);
  });

  it("refuses writes hidden in a read: a data-modifying CTE, SELECT INTO, a lock", () => {
    expect(refused("WITH d AS (DELETE FROM orders RETURNING *) SELECT count(*) FROM d")).toMatch(/DELETE/);
    expect(refused("WITH u AS (UPDATE orders SET total = 0 RETURNING 1) SELECT count(*) FROM u")).toMatch(/UPDATE/);
    expect(refused("SELECT * INTO backup FROM orders")).toMatch(/INTO/);
    expect(refused("SELECT * FROM orders FOR UPDATE")).toMatch(/UPDATE/);
    expect(refused("SELECT * FROM orders FOR SHARE")).toMatch(/SHARE/);
  });

  it("refuses functions off the list: ones that sleep, call out, read files or run SQL of their own", () => {
    for (const f of ["pg_sleep(10)", "query_to_xml('select * from users', true, true, '')", "dblink_exec('x', 'drop table orders')", "nextval('s')", "lo_import('/etc/passwd')", "set_config('a', 'b', false)", "pg_read_file('/etc/passwd')", "current_setting('x')"])
      expect(refused(`SELECT ${f} FROM orders`)).toMatch(/isn't one Qalam lets a metric use/);
    // Not taken for a CTE's name with its columns: a select item's alias comes after it.
    expect(refused("SELECT a, pg_sleep(1) AS x FROM orders")).toMatch(/pg_sleep/);
    expect(refused("WITH a AS (SELECT 1 FROM orders), pg_sleep(1) AS x SELECT 1 FROM a")).toMatch(/pg_sleep/);
    expect(refused("SELECT pg_catalog.pg_sleep(1) FROM orders")).toMatch(/function in a schema/);
    expect(refused("SELECT pg_catalog.sum(total) FROM orders")).toMatch(/function in a schema/);
  });

  it("refuses parameters, dollar quotes and strings that escape differently", () => {
    expect(refused("SELECT count(*) FROM orders WHERE id = $1")).toMatch(/\$/);
    expect(refused("SELECT $$a$$ FROM orders")).toMatch(/\$/);
    expect(refused("SELECT E'\\x27' FROM orders")).toMatch(/escapes differently/);
    expect(refused("SELECT 'a\\' FROM orders")).toMatch(/backslash/);
    expect(refused("SELECT U&'d\\0061t' FROM orders")).toMatch(/escapes differently/);
  });

  it("refuses what it can't read to the end", () => {
    expect(refused("SELECT 1 /* /* */ FROM orders")).toMatch(/never ends/);
    expect(refused("SELECT 'open FROM orders")).toMatch(/never ends/);
    expect(refused(`SELECT count(*) FROM "orders`)).toMatch(/never ends/);
    expect(refused("SELECT count(*) FROM orders WHERE (a = 1")).toMatch(/parentheses/);
  });

  it("refuses a table in another database", () => {
    expect(refused("SELECT count(*) FROM other.public.orders")).toMatch(/another database/);
  });
});

describe("the guard on MySQL", () => {
  it("takes MySQL's own way of writing a read", () => {
    const g = ok("SELECT SUM(`total`) FROM `orders` WHERE status = 'paid' AND created_at >= NOW() - INTERVAL 30 DAY", "mysql");
    expect(g.tables).toEqual([{ name: "orders" }]);
    expect(ok("SELECT COUNT(*) FROM shop.orders", "mysql").tables).toEqual([{ schema: "shop", name: "orders" }]);
    expect(ok("SELECT TRUNCATE(SUM(total), 2) FROM orders", "mysql").functions).toContain("truncate");
    expect(ok("SELECT IF(COUNT(*) > 0, 1, 0) FROM orders", "mysql").tables).toEqual([{ name: "orders" }]);
  });

  it("reads #, '-- ' and '--1' as MySQL does", () => {
    expect(ok("SELECT COUNT(*) FROM orders # all of them", "mysql").sql).toBe("SELECT COUNT(*) FROM orders");
    expect(ok("SELECT COUNT(*) FROM orders -- all", "mysql").sql).toBe("SELECT COUNT(*) FROM orders");
    expect(ok("SELECT 1--1 FROM orders", "mysql").sql).toBe("SELECT 1--1 FROM orders");
  });

  it("refuses comments MySQL runs as code, and its hints", () => {
    expect(refused("SELECT /*! 50000 SLEEP(5) */ 1 FROM orders", "mysql")).toMatch(/run as code/);
    expect(refused("SELECT /*+ MAX_EXECUTION_TIME(1) */ 1 FROM orders", "mysql")).toMatch(/run as code/);
    expect(refused("SELECT 1 /* a /* b */ FROM orders", "mysql")).toMatch(/inside a comment/);
  });

  it("refuses MySQL's ways out: files, sleeps, variables, double quotes, backslashes, locks, parameters", () => {
    expect(refused("SELECT SLEEP(5) FROM orders", "mysql")).toMatch(/SLEEP/);
    expect(refused("SELECT BENCHMARK(1000000, MD5('a')) FROM orders", "mysql")).toMatch(/BENCHMARK/);
    expect(refused("SELECT LOAD_FILE('/etc/passwd') FROM orders", "mysql")).toMatch(/LOAD_FILE/);
    expect(refused("SELECT * FROM orders INTO OUTFILE '/tmp/x'", "mysql")).toMatch(/INTO/);
    expect(refused("SELECT @@version FROM orders", "mysql")).toMatch(/variable/);
    expect(refused("SELECT @a := 1 FROM orders", "mysql")).toMatch(/variable/);
    expect(refused(`SELECT "x" FROM orders`, "mysql")).toMatch(/double-quoted/);
    expect(refused("SELECT 'a\\'b' FROM orders", "mysql")).toMatch(/backslash/);
    expect(refused("SELECT * FROM orders LOCK IN SHARE MODE", "mysql")).toMatch(/LOCK/);
    expect(refused("SELECT * FROM orders WHERE id = ?", "mysql")).toMatch(/parameter/);
    expect(refused("TRUNCATE orders", "mysql")).toMatch(/doesn't start with SELECT/);
    expect(refused("SELECT _utf8mb4'x' FROM orders", "mysql")).toMatch(/escapes differently/);
  });
});
