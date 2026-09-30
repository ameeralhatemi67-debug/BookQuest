// A deliberately small PostgREST look-alike: exactly the subset of the Data API
// this app uses (RPC calls and single-table CRUD with simple filters).
// Anything outside that subset fails loudly rather than guessing.
import type { Transaction } from "@electric-sql/pglite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Claims, EmuDb, PgError } from "./db";
import { readJson, sendJson } from "./util";

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new HttpError(400, "PGRST100", `invalid identifier "${name}"`);
  return `"${name}"`;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: string | null = null,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- catalog
interface FnSignature {
  args: { name: string; type: string }[];
  returns: string;
}

const fnCache = new Map<string, FnSignature>();
const columnCache = new Map<string, Map<string, string>>();

async function getFunction(tx: Transaction, name: string): Promise<FnSignature> {
  const cached = fnCache.get(name);
  if (cached) return cached;
  const res = await tx.query<{ args: string; returns: string }>(
    `select pg_get_function_identity_arguments(p.oid) as args, p.prorettype::regtype::text as returns
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  if (res.rows.length !== 1) {
    throw new HttpError(404, "PGRST202", `Could not find the function public.${name} in the schema cache`);
  }
  const args = res.rows[0].args
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const space = part.indexOf(" ");
      return { name: part.slice(0, space), type: part.slice(space + 1) };
    });
  const signature = { args, returns: res.rows[0].returns };
  fnCache.set(name, signature);
  return signature;
}

async function getColumns(tx: Transaction, table: string): Promise<Map<string, string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const res = await tx.query<{ name: string; type: string }>(
    `select a.attname::text as name, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a
      where a.attrelid = to_regclass($1) and a.attnum > 0 and not a.attisdropped`,
    [`public.${table}`],
  );
  if (res.rows.length === 0) {
    throw new HttpError(404, "PGRST205", `Could not find the table 'public.${table}' in the schema cache`);
  }
  const columns = new Map(res.rows.map((r) => [r.name, r.type]));
  columnCache.set(table, columns);
  return columns;
}

/** Serializes a JSON value into the text form Postgres expects for `type`. */
function toPgText(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) throw new HttpError(400, "22P02", `expected an array for ${type}`);
    return `{${value.map((v) => (v === null ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;
  }
  if (type === "json" || type === "jsonb") return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------- RPC
export async function callRpc(tx: Transaction, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  ident(name);
  const signature = await getFunction(tx, name);
  const params: (string | null)[] = [];
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const arg = signature.args.find((a) => a.name === key);
    if (!arg) {
      throw new HttpError(404, "PGRST202", `Could not find the function public.${name}(${Object.keys(args).join(", ")}) in the schema cache`);
    }
    params.push(toPgText(value, arg.type));
    parts.push(`${ident(key)} => $${params.length}::text::${arg.type}`);
  }
  const call = `public.${ident(name)}(${parts.join(", ")})`;
  if (signature.returns === "void") {
    await tx.query(`select ${call}`, params);
    return null;
  }
  const res = await tx.query<{ result: unknown }>(`select to_jsonb(${call}) as result`, params);
  return res.rows[0]?.result ?? null;
}

// ---------------------------------------------------------------- filters
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const OPS: Record<string, string> = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike",
};

function parseList(raw: string): string[] {
  // (a,b,"c,d") → ["a", "b", "c,d"]
  const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quoted) {
      if (ch === "\\" && i + 1 < inner.length) current += inner[++i];
      else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(current);
      current = "";
    } else current += ch;
  }
  if (current !== "" || inner !== "") out.push(current);
  return out;
}

function buildWhere(query: URLSearchParams, columns: Map<string, string>, params: (string | null)[]): string {
  const clauses: string[] = [];
  for (const [key, rawValue] of query.entries()) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") throw new HttpError(400, "PGRST100", "or/and filters are not supported by the emulator");
    const type = columns.get(key);
    if (!type) throw new HttpError(400, "42703", `column ${key} does not exist`);
    let value = rawValue;
    let negate = false;
    if (value.startsWith("not.")) {
      negate = true;
      value = value.slice(4);
    }
    const dot = value.indexOf(".");
    const op = dot === -1 ? value : value.slice(0, dot);
    const operand = dot === -1 ? "" : value.slice(dot + 1);
    const column = ident(key);
    let clause: string;
    if (op === "is") {
      if (!["null", "true", "false"].includes(operand)) throw new HttpError(400, "PGRST100", `unsupported is.${operand}`);
      clause = `${column} is ${operand}`;
    } else if (op === "in") {
      const list = parseList(operand);
      params.push(toPgText(list, "text[]"));
      clause = `${column} = any ($${params.length}::text::${type}[])`;
    } else if (OPS[op]) {
      params.push(op === "like" || op === "ilike" ? operand.replace(/\*/g, "%") : operand);
      clause = `${column} ${OPS[op]} $${params.length}::text::${op === "like" || op === "ilike" ? "text" : type}`;
    } else {
      throw new HttpError(400, "PGRST100", `unsupported filter operator "${op}"`);
    }
    clauses.push(negate ? `not (${clause})` : clause);
  }
  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

function buildSelectList(raw: string | null, columns: Map<string, string>): string {
  if (!raw || raw === "*") return "*";
  if (/[()]/.test(raw)) throw new HttpError(400, "PGRST100", "embedded resources are not supported by the emulator");
  return raw
    .split(",")
    .map((c) => c.trim())
    .map((c) => {
      if (!columns.has(c)) throw new HttpError(400, "42703", `column ${c} does not exist`);
      return ident(c);
    })
    .join(", ");
}

function buildOrder(raw: string | null, columns: Map<string, string>): string {
  if (!raw) return "";
  const parts = raw.split(",").map((part) => {
    const [col, ...mods] = part.split(".");
    if (!columns.has(col)) throw new HttpError(400, "42703", `column ${col} does not exist`);
    let sql = ident(col);
    if (mods.includes("desc")) sql += " desc";
    if (mods.includes("nullsfirst")) sql += " nulls first";
    if (mods.includes("nullslast")) sql += " nulls last";
    return sql;
  });
  return `order by ${parts.join(", ")}`;
}

// ---------------------------------------------------------------- table CRUD
export interface TableRequest {
  method: string;
  table: string;
  query: URLSearchParams;
  body?: unknown;
  prefer?: string;
}

export async function tableRequest(tx: Transaction, req: TableRequest): Promise<{ rows: unknown[] | null; status: number }> {
  const table = ident(req.table);
  const columns = await getColumns(tx, req.table);
  const prefer = req.prefer ?? "";
  const representation = prefer.includes("return=representation");
  const params: (string | null)[] = [];
  const selectList = buildSelectList(req.query.get("select"), columns);
  const asRows = (cte: string) =>
    `${cte} select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as rows from (select ${selectList} from changed) r`;

  if (req.method === "GET" || req.method === "HEAD") {
    const where = buildWhere(req.query, columns, params);
    const order = buildOrder(req.query.get("order"), columns);
    const limit = req.query.get("limit");
    const offset = req.query.get("offset");
    const sql = `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as rows from (
      select ${selectList} from public.${table} ${where} ${order}
      ${limit ? `limit ${Number(limit) | 0}` : ""} ${offset ? `offset ${Number(offset) | 0}` : ""}
    ) r`;
    const res = await tx.query<{ rows: unknown[] }>(sql, params);
    return { rows: res.rows[0].rows, status: 200 };
  }

  if (req.method === "POST") {
    const records = Array.isArray(req.body) ? req.body : [req.body];
    if (records.length === 0 || typeof records[0] !== "object" || records[0] === null) {
      throw new HttpError(400, "PGRST102", "empty or invalid request body");
    }
    const keys = Object.keys(records[0] as object);
    for (const key of keys) if (!columns.has(key)) throw new HttpError(400, "PGRST204", `Could not find the '${key}' column of '${req.table}' in the schema cache`);
    const cols = keys.map(ident).join(", ");
    params.push(JSON.stringify(records));
    let conflict = "";
    if (prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates")) {
      const target = (req.query.get("on_conflict") ?? "").split(",").filter(Boolean).map(ident).join(", ");
      conflict = prefer.includes("resolution=ignore-duplicates")
        ? `on conflict ${target ? `(${target})` : ""} do nothing`
        : `on conflict (${target}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`;
    }
    const insert = `insert into public.${table} (${cols})
      select ${cols} from jsonb_populate_recordset(null::public.${table}, $1::text::jsonb) ${conflict}`;
    if (!representation) {
      await tx.query(insert, params);
      return { rows: null, status: 201 };
    }
    const res = await tx.query<{ rows: unknown[] }>(asRows(`with changed as (${insert} returning *)`), params);
    return { rows: res.rows[0].rows, status: 201 };
  }

  if (req.method === "PATCH") {
    if (typeof req.body !== "object" || req.body === null) throw new HttpError(400, "PGRST102", "invalid request body");
    const keys = Object.keys(req.body);
    for (const key of keys) if (!columns.has(key)) throw new HttpError(400, "PGRST204", `Could not find the '${key}' column of '${req.table}' in the schema cache`);
    const cols = keys.map(ident).join(", ");
    params.push(JSON.stringify(req.body));
    const where = buildWhere(req.query, columns, params);
    const update = `update public.${table} set (${cols}) = (select ${cols} from jsonb_populate_record(null::public.${table}, $1::text::jsonb)) ${where}`;
    if (!representation) {
      await tx.query(update, params);
      return { rows: null, status: 204 };
    }
    const res = await tx.query<{ rows: unknown[] }>(asRows(`with changed as (${update} returning *)`), params);
    return { rows: res.rows[0].rows, status: 200 };
  }

  if (req.method === "DELETE") {
    const where = buildWhere(req.query, columns, params);
    const del = `delete from public.${table} ${where}`;
    if (!representation) {
      await tx.query(del, params);
      return { rows: null, status: 204 };
    }
    const res = await tx.query<{ rows: unknown[] }>(asRows(`with changed as (${del} returning *)`), params);
    return { rows: res.rows[0].rows, status: 200 };
  }

  throw new HttpError(405, "PGRST117", `unsupported method ${req.method}`);
}

// ---------------------------------------------------------------- errors
export function pgErrorToHttp(error: unknown, authenticated: boolean): { status: number; body: Record<string, unknown> } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { code: error.code, message: error.message, details: error.details, hint: null } };
  }
  const pg = error as PgError;
  const code = pg.code ?? "XX000";
  let status = 500;
  if (code === "42501") status = authenticated ? 403 : 401;
  else if (code === "23505" || code === "23503") status = 409;
  else if (code.startsWith("23") || code.startsWith("22") || code === "P0001" || code.startsWith("42")) status = 400;
  return { status, body: { code, message: pg.message, details: pg.detail ?? null, hint: pg.hint ?? null } };
}

// ---------------------------------------------------------------- HTTP
export async function handleRest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  db: EmuDb,
  claims: Claims | null,
): Promise<void> {
  const path = url.pathname.replace(/^\/rest\/v1\/?/, "");
  const accept = String(req.headers.accept ?? "");
  const wantsObject = accept.includes("application/vnd.pgrst.object+json");
  try {
    if (path.startsWith("rpc/")) {
      const name = path.slice(4);
      const args = req.method === "GET" ? Object.fromEntries(url.searchParams) : ((await readJson(req)) ?? {});
      const result = await db.asUser(claims, (tx) => callRpc(tx, name, args as Record<string, unknown>));
      if (result === null) {
        res.writeHead(204).end();
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    const body = req.method === "POST" || req.method === "PATCH" ? await readJson(req) : undefined;
    const { rows, status } = await db.asUser(claims, (tx) =>
      tableRequest(tx, { method: req.method ?? "GET", table: path, query: url.searchParams, body, prefer: String(req.headers.prefer ?? "") }),
    );
    if (rows === null) {
      res.writeHead(status).end();
      return;
    }
    if (wantsObject) {
      if (rows.length !== 1) {
        sendJson(res, 406, {
          code: "PGRST116",
          message: "Cannot coerce the result to a single JSON object",
          details: `The result contains ${rows.length} rows`,
          hint: null,
        });
        return;
      }
      sendJson(res, status, rows[0]);
      return;
    }
    res.setHeader("Content-Range", rows.length ? `0-${rows.length - 1}/*` : "*/*");
    sendJson(res, status, rows);
  } catch (error) {
    const { status, body } = pgErrorToHttp(error, claims !== null);
    sendJson(res, status, body);
  }
}
