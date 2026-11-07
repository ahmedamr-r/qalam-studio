/*
 * A team's database connection string, read (pure): which kind, where it points and as whom, and how
 * it's encrypted. The password stays in the string, which only ever goes to the Keychain; what's shown
 * and kept anywhere else is the label (user@host:port/database) and where it points (host:port/database),
 * so two computers on different databases (production and staging) can be told apart. A remote
 * database is always reached over TLS with its certificate checked; plain text only on this computer.
 */

export type SqlKind = "postgres" | "mysql";

export interface Connection {
  kind: SqlKind;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** TLS with the server's certificate checked, or none (only for a database on this computer). */
  tls: boolean;
  /** On this computer (localhost). */
  local: boolean;
  /** "reader@db.example.com:5432/shop", never the password. */
  label: string;
  /** "db.example.com:5432/shop": the database it points at. */
  where: string;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Read a connection string, or say why it can't be used. */
export function parseConnection(raw: string): Connection | { why: string } {
  const text = raw.trim();
  if (!text) return { why: "Paste a connection string." };
  if (text.length > 2000) return { why: "That's too long for a connection string." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { why: "That doesn't read as a connection string (postgres://… or mysql://…)." };
  }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  const kind: SqlKind | null = scheme === "postgres" || scheme === "postgresql" ? "postgres" : scheme === "mysql" || scheme === "mariadb" ? "mysql" : null;
  if (!kind) return { why: "Qalam reads Postgres and MySQL: the string should start with postgres:// or mysql://." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { why: "The string names no host." };
  const user = decodeURIComponent(u.username);
  if (!user) return { why: "The string names no user: Qalam needs the read-only user's name." };
  const password = decodeURIComponent(u.password);
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || (kind === "postgres" ? "postgres" : "");
  if (!database) return { why: "The string names no database: add it after the host (…/shop)." };
  if (/[\\\u0000]/.test(database + user)) return { why: "The database or user name has a character Qalam can't pass on safely." };
  const port = u.port ? Number(u.port) : kind === "postgres" ? 5432 : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { why: "The port isn't a number Qalam can use." };
  const local = LOCAL.has(host.toLowerCase());
  const mode = (u.searchParams.get("sslmode") ?? u.searchParams.get("ssl-mode") ?? u.searchParams.get("sslMode") ?? "").toLowerCase();
  if (mode === "no-verify") return { why: "Qalam checks the server's certificate, so it doesn't take sslmode=no-verify. Add the server's CA certificate instead." };
  const off = mode === "disable" || mode === "disabled" || mode === "false";
  if (off && !local) return { why: "That would send the password unencrypted. Qalam reaches a database on another computer over TLS only." };
  const tls = local ? mode === "require" || mode === "required" || mode.startsWith("verify") : true;
  const where = `${host}:${port}/${database}`;
  return { kind, host, port, database, user, password, tls, local, label: `${user}@${where}`, where };
}

/** The SQL that makes a user who can only read, for the person to give to whoever runs the database. */
export function readerSql(kind: SqlKind | "supabase", database = "your_database"): string {
  if (kind === "supabase")
    return [
      "-- In Supabase's SQL editor. BYPASSRLS lets totals count every row, as the dashboard does.",
      "CREATE ROLE qalam_reader WITH LOGIN BYPASSRLS PASSWORD 'choose-a-long-password';",
      "GRANT pg_read_all_data TO qalam_reader;",
      "ALTER ROLE qalam_reader SET default_transaction_read_only = on;",
    ].join("\n");
  if (kind === "mysql")
    return [
      "CREATE USER 'qalam_reader'@'%' IDENTIFIED BY 'choose-a-long-password';",
      `GRANT SELECT, SHOW VIEW ON \`${database}\`.* TO 'qalam_reader'@'%';`,
    ].join("\n");
  return [
    "CREATE ROLE qalam_reader WITH LOGIN PASSWORD 'choose-a-long-password';",
    `GRANT CONNECT ON DATABASE "${database}" TO qalam_reader;`,
    "GRANT USAGE ON SCHEMA public TO qalam_reader;",
    "GRANT SELECT ON ALL TABLES IN SCHEMA public TO qalam_reader;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO qalam_reader;",
    "ALTER ROLE qalam_reader SET default_transaction_read_only = on;",
  ].join("\n");
}
