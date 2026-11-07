import { createInterface } from "node:readline";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { SAMPLE_SCHEMA } from "./sample-schema";

/*
 * A small Postgres for tests, in its own process (PGlite runs its queries on the JS thread, which
 * would hold up the test's own timers): a grocery delivery business with customers (personal
 * columns), orders (an enum status, cents, a soft delete), refunds, deliveries (what customers pay
 * and what couriers cost), a migrations table, sessions, and a table row-level security hides. Its
 * roles: reader (SELECT only), writer (INSERT on orders), member (UPDATE on refunds through a role it
 * belongs to). PGlite serves every connection as its own superuser in one shared session, so "AS <role>"
 * on stdin sets that session's role (SET ROLE: SET SESSION AUTHORIZATION can't be taken back there)
 * for whatever connects next; "AS postgres" goes back. Prints READY <port>.
 */

const db = await PGlite.create();
await db.exec(SAMPLE_SCHEMA);
const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 8 });
await server.start();
console.log(`READY ${server.getServerConn().split(":").pop()}`);
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const role = /^AS ([a-z_]+)$/.exec(line.trim())?.[1];
  if (!role) return;
  void db
    .exec(role === "postgres" ? "RESET ROLE" : `RESET ROLE; SET ROLE ${role}`)
    .then(() => console.log(`OK ${role}`), (e: unknown) => console.log(`ERR ${e instanceof Error ? e.message : String(e)}`));
});
lines.on("close", () => void server.stop().then(() => db.close()).finally(() => process.exit(0)));
