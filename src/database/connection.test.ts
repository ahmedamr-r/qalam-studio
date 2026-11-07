import { describe, expect, it } from "vitest";
import { parseConnection, readerSql } from "./connection";

describe("a connection string", () => {
  it("reads Postgres and MySQL, keeping the password out of the label", () => {
    expect(parseConnection("postgres://reader:s%40cret@db.example.com:6543/shop")).toMatchObject({ kind: "postgres", host: "db.example.com", port: 6543, database: "shop", user: "reader", password: "s@cret", tls: true, local: false, label: "reader@db.example.com:6543/shop", where: "db.example.com:6543/shop" });
    expect(parseConnection("mysql://reader:x@shop.mysql.example.com/shop")).toMatchObject({ kind: "mysql", port: 3306, tls: true });
    expect(parseConnection("postgresql://reader@localhost/postgres")).toMatchObject({ kind: "postgres", port: 5432, tls: false, local: true });
    expect(parseConnection("postgres://postgres.abcd:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")).toMatchObject({ user: "postgres.abcd" });
  });

  it("encrypts a database on another computer, and checks its certificate", () => {
    expect(parseConnection("postgres://r:p@db.example.com/shop?sslmode=disable")).toEqual({ why: expect.stringMatching(/unencrypted/) });
    expect(parseConnection("postgres://r:p@db.example.com/shop?sslmode=no-verify")).toEqual({ why: expect.stringMatching(/certificate/) });
    expect(parseConnection("postgres://r:p@db.example.com/shop?sslmode=prefer")).toMatchObject({ tls: true });
    expect(parseConnection("postgres://r:p@127.0.0.1/shop?sslmode=require")).toMatchObject({ tls: true, local: true });
  });

  it("says what's missing in words", () => {
    expect(parseConnection("")).toEqual({ why: expect.stringMatching(/Paste/) });
    expect(parseConnection("https://example.com")).toEqual({ why: expect.stringMatching(/Postgres and MySQL/) });
    expect(parseConnection("postgres://db.example.com/shop")).toEqual({ why: expect.stringMatching(/no user/) });
    expect(parseConnection("mysql://r:p@db.example.com")).toEqual({ why: expect.stringMatching(/no database/) });
    expect(parseConnection("not a url")).toEqual({ why: expect.stringMatching(/doesn't read as a connection string/) });
  });

  it("offers the SQL for a user who can only read", () => {
    expect(readerSql("postgres", "shop")).toMatch(/GRANT SELECT ON ALL TABLES IN SCHEMA public TO qalam_reader;/);
    expect(readerSql("mysql", "shop")).toMatch(/GRANT SELECT, SHOW VIEW ON `shop`\.\*/);
    expect(readerSql("supabase")).toMatch(/BYPASSRLS/);
    for (const k of ["postgres", "mysql", "supabase"] as const) expect(readerSql(k)).not.toMatch(/INSERT|UPDATE|DELETE|ALL PRIVILEGES/);
  });
});
