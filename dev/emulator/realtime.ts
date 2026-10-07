// Supabase Realtime look-alike (Phoenix channels, protocol vsn 2.0.0):
//   * Postgres Changes — each change is re-read under the subscriber's own RLS
//     before it is delivered, so protected rows only reach readers allowed to
//     select them (the same guarantee the hosted service gives).
//   * Presence — on private channels, authorized by the realtime.messages
//     policies from our migrations.
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { claimsFromToken } from "./auth";
import type { Claims, EmuDb } from "./db";

type Frame = [string | null, string | null, string, string, Record<string, unknown>];

interface Binding {
  id: number;
  event: string;
  schema: string;
  table?: string;
  filter?: string;
}

interface Subscription {
  socket: WebSocket;
  topic: string; // "realtime:room:…"
  joinRef: string | null;
  claims: Claims | null;
  bindings: Binding[];
  presenceKey: string;
  presenceRef: string | null;
  presenceMeta: Record<string, unknown> | null;
  presenceEnabled: boolean;
}

interface Change {
  table: string;
  type: "INSERT" | "UPDATE" | "DELETE";
  pk: Record<string, unknown>;
}

export function createRealtime(db: EmuDb, log: (message: string) => void) {
  const wss = new WebSocketServer({ noServer: true });
  const subscriptions = new Set<Subscription>();
  let nextBindingId = 1;

  const send = (socket: WebSocket, frame: Frame) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
  };

  const subsOn = (topic: string) => [...subscriptions].filter((s) => s.topic === topic);

  function presenceState(topic: string) {
    const state: Record<string, { metas: Record<string, unknown>[] }> = {};
    for (const sub of subsOn(topic)) {
      if (!sub.presenceMeta) continue;
      (state[sub.presenceKey] ??= { metas: [] }).metas.push({ phx_ref: sub.presenceRef, ...sub.presenceMeta });
    }
    return state;
  }

  function broadcastPresenceDiff(topic: string, joins: Record<string, unknown>, leaves: Record<string, unknown>) {
    for (const sub of subsOn(topic)) {
      if (sub.presenceEnabled) send(sub.socket, [sub.joinRef, null, topic, "presence_diff", { joins, leaves }]);
    }
  }

  function untrack(sub: Subscription) {
    if (!sub.presenceMeta) return;
    const leaves = { [sub.presenceKey]: { metas: [{ phx_ref: sub.presenceRef, ...sub.presenceMeta }] } };
    sub.presenceMeta = null;
    sub.presenceRef = null;
    broadcastPresenceDiff(sub.topic, {}, leaves);
  }

  function drop(sub: Subscription) {
    untrack(sub);
    subscriptions.delete(sub);
  }

  /** Private channels: allowed only if the realtime.messages policies admit this user for this topic. */
  async function authorize(claims: Claims | null, topic: string): Promise<boolean> {
    const name = topic.replace(/^realtime:/, "");
    const ROLLBACK = Symbol("rollback");
    let ok = false;
    try {
      await db.asUser(
        claims,
        async (tx) => {
          await tx.query("insert into realtime.messages (topic, extension) values ($1, 'presence')", [name]);
          const res = await tx.query("select 1 from realtime.messages where topic = $1 and extension = 'presence'", [name]);
          ok = res.rows.length > 0;
          throw ROLLBACK;
        },
        { "realtime.topic": name },
      );
    } catch (error) {
      if (error !== ROLLBACK) ok = false;
    }
    return ok;
  }

  function matchesFilter(filter: string | undefined, row: Record<string, unknown>): boolean {
    if (!filter) return true;
    const match = /^([a-z_][a-z0-9_]*)=(eq|neq|in)\.(.*)$/.exec(filter);
    if (!match) return false;
    const [, column, op, raw] = match;
    const value = row[column] === null || row[column] === undefined ? null : String(row[column]);
    if (op === "eq") return value === raw;
    if (op === "neq") return value !== raw;
    return raw.replace(/^\(|\)$/g, "").split(",").includes(value ?? "");
  }

  async function deliver(change: Change) {
    const commitTimestamp = new Date().toISOString();
    for (const sub of [...subscriptions]) {
      const bindings = sub.bindings.filter(
        (b) =>
          (b.schema === "public" || b.schema === "*") &&
          (!b.table || b.table === change.table) &&
          (b.event === "*" || b.event.toUpperCase() === change.type),
      );
      if (bindings.length === 0) continue;

      let record: Record<string, unknown> | null = null;
      if (change.type !== "DELETE") {
        const keys = Object.keys(change.pk);
        const where = keys.map((k, i) => `"${k}"::text = $${i + 1}`).join(" and ");
        try {
          record = await db.asUser(sub.claims, async (tx) => {
            const res = await tx.query<{ row: Record<string, unknown> }>(
              `select to_jsonb(t) as row from public."${change.table}" t where ${where}`,
              keys.map((k) => String(change.pk[k])),
            );
            return res.rows[0]?.row ?? null;
          });
        } catch {
          record = null;
        }
        if (!record) continue; // RLS says this subscriber may not see the row
      }

      // Like Supabase: filters are not applied to DELETE events (only the PK is known).
      const ids = bindings
        .filter((b) => change.type === "DELETE" || matchesFilter(b.filter, record!))
        .map((b) => b.id);
      if (ids.length === 0) continue;

      send(sub.socket, [sub.joinRef, null, sub.topic, "postgres_changes", {
        ids,
        data: {
          schema: "public",
          table: change.table,
          commit_timestamp: commitTimestamp,
          type: change.type,
          columns: [],
          record: record ?? {},
          old_record: change.type === "INSERT" ? {} : change.pk,
          errors: null,
        },
      }]);
    }
  }

  // Changes are delivered strictly in commit order.
  let queue = Promise.resolve();
  void db.pg.listen("emu_changes", (payload) => {
    const change = JSON.parse(payload) as Change;
    queue = queue.then(() => deliver(change)).catch((error) => log(`realtime delivery failed: ${(error as Error).message}`));
  });

  wss.on("connection", (socket) => {
    socket.on("message", async (raw) => {
      let frame: Frame;
      try {
        frame = JSON.parse(raw.toString()) as Frame;
      } catch {
        return;
      }
      const [joinRef, ref, topic, event, payload] = frame;
      const reply = (status: "ok" | "error", response: Record<string, unknown> = {}) =>
        send(socket, [joinRef, ref, topic, "phx_reply", { status, response }]);
      const current = [...subscriptions].find((s) => s.socket === socket && s.topic === topic);

      if (topic === "phoenix" && event === "heartbeat") return reply("ok");

      if (event === "phx_join") {
        if (current) drop(current);
        const config = (payload.config ?? {}) as {
          private?: boolean;
          presence?: { key?: string; enabled?: boolean };
          postgres_changes?: Omit<Binding, "id">[];
        };
        const claims = claimsFromToken(payload.access_token as string | undefined);
        if (config.private && !(await authorize(claims, topic))) {
          return reply("error", { reason: "Unauthorized: You do not have permissions to read from this Channel topic: " + topic.replace(/^realtime:/, "") });
        }
        const sub: Subscription = {
          socket, topic, joinRef, claims,
          bindings: (config.postgres_changes ?? []).map((b) => ({ ...b, id: nextBindingId++ })),
          presenceKey: config.presence?.key || randomUUID(),
          presenceRef: null,
          presenceMeta: null,
          presenceEnabled: config.presence?.enabled !== false,
        };
        subscriptions.add(sub);
        reply("ok", { postgres_changes: sub.bindings });
        if (sub.bindings.length) {
          send(socket, [joinRef, null, topic, "system", { status: "ok", extension: "postgres_changes", channel: topic.replace(/^realtime:/, ""), message: "Subscribed to PostgreSQL" }]);
        }
        if (sub.presenceEnabled) send(socket, [joinRef, null, topic, "presence_state", presenceState(topic)]);
        return;
      }

      if (!current) return reply("error", { reason: "not joined" });

      if (event === "phx_leave") {
        drop(current);
        return reply("ok");
      }

      if (event === "access_token") {
        const claims = claimsFromToken(payload.access_token as string | undefined);
        if (claims) current.claims = claims;
        return;
      }

      if (event === "broadcast") {
        // Private channels already passed the realtime.messages policy at join.
        // Like Supabase's default (self: false), the sender does not get it back.
        for (const sub of subscriptions) {
          if (sub.topic === topic && sub !== current) send(sub.socket, [sub.joinRef, null, topic, "broadcast", payload]);
        }
        return reply("ok");
      }

      if (event === "presence") {
        const inner = payload as { event?: string; payload?: Record<string, unknown> };
        if (inner.event === "track") {
          const leaves = current.presenceMeta
            ? { [current.presenceKey]: { metas: [{ phx_ref: current.presenceRef, ...current.presenceMeta }] } }
            : {};
          current.presenceMeta = inner.payload ?? {};
          current.presenceRef = randomUUID().slice(0, 8);
          reply("ok");
          broadcastPresenceDiff(topic, { [current.presenceKey]: { metas: [{ phx_ref: current.presenceRef, ...current.presenceMeta }] } }, leaves);
          return;
        }
        if (inner.event === "untrack") {
          untrack(current);
          return reply("ok");
        }
      }

      reply("ok");
    });

    socket.on("close", () => {
      for (const sub of [...subscriptions]) if (sub.socket === socket) drop(sub);
    });
    socket.on("error", () => socket.close());
  });

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    },
    /** Test hook: drop every websocket to exercise client reconnection. */
    disconnectAll() {
      for (const client of wss.clients) client.terminate();
    },
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}
