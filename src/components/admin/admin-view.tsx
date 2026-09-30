"use client";

// The alpha admin area: enough to run a 12-person test. It shows who is here,
// what exists and what people told us — and deliberately never the contents of
// anyone's notes.
import { Tabs } from "radix-ui";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { CopyField } from "@/components/room/invite-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge, Card, Spinner } from "@/components/ui/misc";
import { siteUrl } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { cn, formatBytes, formatDate, formatDuration, timeAgo } from "@/lib/format";
import { formatPercent } from "@/lib/location";
import { getSupabase } from "@/lib/supabase/client";

type Json = Record<string, unknown>;

interface Overview {
  testers: { total: number; active: number; pending: number; disabled: number };
  active_readers_7d: number;
  active_readers_24h: number;
  books: number;
  books_bytes: number;
  rooms: { total: number; active: number; open: number; unlisted: number; private: number };
  annotations: number;
  replies: number;
  reactions: number;
  unlocks: number;
  attachments: { total: number; image: number; audio: number; video: number; bytes: number };
  storage: Record<string, { objects: number; bytes: number }> | null;
  feedback: { total: number; new: number };
  errors_7d: number;
  reading_seconds: number;
}

interface Tester {
  user_id: string; display_name: string; avatar_path: string | null; email: string; email_confirmed: boolean;
  status: "pending" | "active" | "disabled"; is_admin: boolean; access_source: string | null; created_at: string;
  last_seen_at: string | null; rooms: number; books: number; notes: number; last_read_at: string | null;
}

interface AdminRoom {
  id: string; name: string; visibility: string; mode: string; member_limit: number | null; is_closed: boolean; archived_at: string | null;
  created_at: string; last_activity_at: string; owner: string; book_title: string; notes: number; replies: number;
  members: { user_id: string; display_name: string; role: string; status: string; furthest: number; last_read_at: string | null }[];
}

interface AdminBook {
  id: string; title: string; author: string | null; format: string; status: string; size_bytes: number | null; mime_type: string | null;
  original_filename: string | null; sha256: string | null; page_count: number | null; created_at: string; error: string | null;
  uploader: string; storage_path: string | null; rooms: number;
}

interface AdminMarker {
  id: string; author: string; position: number; label: string | null; created_at: string; published: boolean; removed: boolean;
  attachments: { kind: string; size_bytes: number; mime_type: string }[];
}

interface Feedback {
  id: string; user_id: string; category: string; message: string; route: string | null; room_id: string | null; book_id: string | null;
  context: Json; status: "new" | "seen" | "done"; created_at: string;
}

interface ClientError { id: number; user_id: string | null; route: string | null; message: string; stack: string | null; context: Json; created_at: string }
interface AlphaCode { code: string; note: string | null; max_uses: number; use_count: number; expires_at: string | null; disabled_at: string | null; created_at: string }
interface AllowEntry { email: string; make_admin: boolean; note: string | null; created_at: string }
interface ModerationRow { id: number; room_id: string | null; actor_id: string | null; action: string; target_user_id: string | null; target_id: string | null; reason: string | null; created_at: string }

function useLoader<T>(load: () => Promise<{ data: T | null; error: unknown }>) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void load().then(({ data, error }) => {
      if (!cancelled) setState({ data, error: error ? friendlyError(error) : null, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [load, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

function Panel<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean }; children: (data: T) => ReactNode }) {
  if (state.loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (state.error || state.data === null) return <p className="py-8 text-center text-sm text-danger" role="alert">{state.error ?? "Couldn't load this."}</p>;
  return <>{children(state.data)}</>;
}

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-raised px-4 py-3.5">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 font-display text-3xl leading-none text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={cn("px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-ink-faint", className)}>{children}</th>
);
const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cn("px-3 py-2.5 align-top text-sm text-ink-soft", className)}>{children}</td>;

function TableCard({ children }: { children: ReactNode }) {
  return (
    <Card className="overflow-x-auto p-1">
      <table className="w-full min-w-[640px] border-collapse [&_tbody_tr]:border-t [&_tbody_tr]:border-line">{children}</table>
    </Card>
  );
}

async function act(action: PromiseLike<{ error: unknown }>, done: () => void, success?: string) {
  const { error } = await action;
  if (error) return void toast.error(friendlyError(error));
  if (success) toast.success(success);
  done();
}

// ---------------------------------------------------------------- overview
const loadOverview = async () => {
  const { data, error } = await getSupabase().rpc("admin_overview");
  return { data: data as Overview | null, error };
};

function OverviewTab() {
  const state = useLoader(loadOverview);
  return (
    <Panel state={state}>
      {(o) => {
        const storageBytes = o.storage ? Object.values(o.storage).reduce((sum, bucket) => sum + bucket.bytes, 0) : o.books_bytes + o.attachments.bytes;
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Testers" value={o.testers.total} hint={`${o.testers.active} active · ${o.testers.pending} pending · ${o.testers.disabled} disabled`} />
              <Tile label="Active readers" value={o.active_readers_7d} hint={`last 7 days · ${o.active_readers_24h} today`} />
              <Tile label="Books" value={o.books} hint={formatBytes(o.books_bytes)} />
              <Tile label="Rooms" value={o.rooms.active} hint={`${o.rooms.open} open · ${o.rooms.unlisted} unlisted · ${o.rooms.private} private`} />
              <Tile label="Notes" value={o.annotations} hint={`${o.replies} replies · ${o.reactions} reactions`} />
              <Tile label="Discoveries" value={o.unlocks} hint="notes reached by a reader" />
              <Tile label="Media attachments" value={o.attachments.total} hint={`${o.attachments.image} img · ${o.attachments.audio} audio · ${o.attachments.video} video`} />
              <Tile label="Storage used" value={formatBytes(storageBytes)} hint={o.storage ? "from Storage's own records" : "estimated from metadata"} />
              <Tile label="Feedback" value={o.feedback.total} hint={`${o.feedback.new} new`} />
              <Tile label="Client errors" value={o.errors_7d} hint="last 7 days" />
              <Tile label="Time spent reading" value={o.reading_seconds >= 60 ? formatDuration(o.reading_seconds) : "—"} hint="all testers" />
            </div>
            {o.storage && (
              <TableCard>
                <thead>
                  <tr>
                    <Th>Bucket</Th>
                    <Th>Objects</Th>
                    <Th>Size</Th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(o.storage).sort().map(([bucket, info]) => (
                    <tr key={bucket}>
                      <Td className="font-mono text-[13px] text-ink">{bucket}</Td>
                      <Td>{info.objects}</Td>
                      <Td>{formatBytes(info.bytes)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableCard>
            )}
          </div>
        );
      }}
    </Panel>
  );
}

// ---------------------------------------------------------------- testers
const loadTesters = async () => {
  const { data, error } = await getSupabase().rpc("admin_list_testers");
  return { data: data as Tester[] | null, error };
};

function TestersTab({ meId }: { meId: string }) {
  const state = useLoader(loadTesters);
  const supabase = getSupabase();
  const set = (tester: Tester, patch: { p_status?: string; p_is_admin?: boolean }, success: string) =>
    act(supabase.rpc("admin_set_tester", { p_user_id: tester.user_id, ...patch }), state.reload, success);
  return (
    <Panel state={state}>
      {(testers) => (
        <TableCard>
          <thead>
            <tr>
              <Th>Tester</Th>
              <Th>Status</Th>
              <Th>Activity</Th>
              <Th>Last seen</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {testers.map((tester) => (
              <tr key={tester.user_id}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar person={{ id: tester.user_id, display_name: tester.display_name, avatar_path: tester.avatar_path }} size={30} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{tester.display_name}</div>
                      <div className="truncate text-xs text-ink-faint">
                        {tester.email}
                        {!tester.email_confirmed && " · unconfirmed"}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={tester.status === "active" ? "moss" : tester.status === "pending" ? "gold" : "danger"}>{tester.status}</Badge>
                    {tester.is_admin && <Badge tone="accent">admin</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-ink-faint">{tester.access_source ?? "no code yet"}</div>
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {tester.rooms} rooms · {tester.books} books · {tester.notes} notes
                  <div className="text-ink-faint">{tester.last_read_at ? `read ${timeAgo(tester.last_read_at)}` : "hasn't read yet"}</div>
                </Td>
                <Td className="whitespace-nowrap text-xs">{tester.last_seen_at ? timeAgo(tester.last_seen_at) : "never"}</Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {tester.status !== "active" && (
                      <Button size="sm" variant="secondary" onClick={() => set(tester, { p_status: "active" }, `${tester.display_name} now has access.`)}>
                        {tester.status === "pending" ? "Grant access" : "Re-enable"}
                      </Button>
                    )}
                    {tester.status === "active" && tester.user_id !== meId && (
                      <Button size="sm" variant="ghost" onClick={() => set(tester, { p_status: "disabled" }, `${tester.display_name}'s access is off.`)}>
                        Disable
                      </Button>
                    )}
                    {tester.status === "active" && tester.user_id !== meId && (
                      <Button size="sm" variant="ghost" onClick={() => set(tester, { p_is_admin: !tester.is_admin }, tester.is_admin ? "Admin removed." : `${tester.display_name} is now an admin.`)}>
                        {tester.is_admin ? "Remove admin" : "Make admin"}
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- access (codes + allowlist)
const loadAccess = async () => {
  const supabase = getSupabase();
  const [codes, allow] = await Promise.all([
    supabase.from("alpha_invite_codes").select("code, note, max_uses, use_count, expires_at, disabled_at, created_at").order("created_at", { ascending: false }),
    supabase.from("alpha_allowlist").select("email, make_admin, note, created_at").order("created_at", { ascending: false }),
  ]);
  return { data: codes.error || allow.error ? null : { codes: (codes.data ?? []) as AlphaCode[], allow: (allow.data ?? []) as AllowEntry[] }, error: codes.error ?? allow.error };
};

function AccessTab() {
  const state = useLoader(loadAccess);
  const supabase = getSupabase();
  const [note, setNote] = useState("");
  const [uses, setUses] = useState("1");
  const [created, setCreated] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function createCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_create_alpha_code", { p_note: note, p_max_uses: Number(uses) || 1, p_expires_in_days: 30 });
    setBusy(false);
    if (error) return void toast.error(friendlyError(error));
    setCreated(data as string);
    setNote("");
    void state.reload();
  }

  async function allowEmail(event: FormEvent) {
    event.preventDefault();
    await act(supabase.from("alpha_allowlist").insert({ email: email.trim().toLowerCase() }), () => {
      setEmail("");
      void state.reload();
    }, "Added. They get access as soon as they sign up with that email.");
  }

  return (
    <div className="space-y-8">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="font-display text-xl text-ink">Invite a tester</h3>
          <p className="text-sm text-ink-soft">Create an alpha code and send the sign-up link. A code works for as many people as you allow, for 30 days.</p>
        </div>
        <form onSubmit={createCode} className="flex flex-wrap items-end gap-3">
          <Field label="Note (who it's for)" className="min-w-48 flex-1">
            {(props) => <Input {...props} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sara" />}
          </Field>
          <Field label="Uses" className="w-24">
            {(props) => <Input {...props} type="number" min={1} max={100} value={uses} onChange={(e) => setUses(e.target.value)} />}
          </Field>
          <Button type="submit" loading={busy}>
            Create code
          </Button>
        </form>
        {created && (
          <div className="animate-fade-up space-y-2 rounded-2xl border border-moss/30 bg-moss-soft/60 p-4">
            <p className="text-sm text-ink">
              New code: <span className="font-mono font-semibold tracking-wider">{created}</span>. Send this link:
            </p>
            <CopyField value={`${siteUrl()}/signup?code=${created}`} label="Sign-up link with code" />
          </div>
        )}
      </Card>

      <Panel state={state}>
        {({ codes, allow }) => (
          <>
            <section>
              <h3 className="mb-3 font-display text-xl text-ink">Alpha codes</h3>
              {codes.length === 0 ? (
                <p className="text-sm text-ink-faint">No codes yet.</p>
              ) : (
                <TableCard>
                  <thead>
                    <tr>
                      <Th>Code</Th>
                      <Th>Note</Th>
                      <Th>Used</Th>
                      <Th>Expires</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((code) => {
                      const expired = code.expires_at !== null && new Date(code.expires_at) < new Date();
                      const dead = Boolean(code.disabled_at) || expired || code.use_count >= code.max_uses;
                      return (
                        <tr key={code.code}>
                          <Td className="font-mono text-[13px] tracking-wider text-ink">{code.code}</Td>
                          <Td>{code.note ?? "—"}</Td>
                          <Td>
                            {code.use_count} / {code.max_uses}
                          </Td>
                          <Td className="whitespace-nowrap">{code.disabled_at ? <Badge tone="danger">disabled</Badge> : expired ? <Badge>expired</Badge> : code.expires_at ? formatDate(code.expires_at) : "never"}</Td>
                          <Td className="text-right">
                            {!dead && (
                              <Button size="sm" variant="ghost" onClick={() => act(supabase.from("alpha_invite_codes").update({ disabled_at: new Date().toISOString() }).eq("code", code.code), state.reload, "Code disabled.")}>
                                Disable
                              </Button>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableCard>
              )}
            </section>

            <section>
              <h3 className="mb-1 font-display text-xl text-ink">Email allowlist</h3>
              <p className="mb-3 text-sm text-ink-soft">An allowlisted email gets access on sign-up without a code.</p>
              <form onSubmit={allowEmail} className="mb-3 flex flex-wrap items-end gap-3">
                <Field label="Email" className="min-w-56 flex-1">
                  {(props) => <Input {...props} type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />}
                </Field>
                <Button type="submit" variant="secondary" disabled={!email.trim()}>
                  Add
                </Button>
              </form>
              {allow.length > 0 && (
                <TableCard>
                  <thead>
                    <tr>
                      <Th>Email</Th>
                      <Th>Admin</Th>
                      <Th>Added</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {allow.map((entry) => (
                      <tr key={entry.email}>
                        <Td className="text-ink">{entry.email}</Td>
                        <Td>{entry.make_admin ? "yes" : "no"}</Td>
                        <Td>{formatDate(entry.created_at)}</Td>
                        <Td className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => act(supabase.from("alpha_allowlist").delete().eq("email", entry.email), state.reload)}>
                            Remove
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableCard>
              )}
            </section>
          </>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- rooms
const loadRooms = async () => {
  const { data, error } = await getSupabase().rpc("admin_list_rooms");
  return { data: data as AdminRoom[] | null, error };
};

function RoomMarkers({ roomId }: { roomId: string }) {
  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("admin_list_markers", { p_room_id: roomId });
    return { data: data as AdminMarker[] | null, error };
  }, [roomId]);
  const state = useLoader(load);
  return (
    <Panel state={state}>
      {(markers) =>
        markers.length === 0 ? (
          <p className="py-3 text-sm text-ink-faint">No notes in this room.</p>
        ) : (
          <ul className="divide-y divide-line">
            {markers.map((marker) => (
              <li key={marker.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="w-12 tabular-nums text-ink-faint">{formatPercent(marker.position)}</span>
                <span className="min-w-0 flex-1 text-ink-soft">
                  <span className="font-medium text-ink">{marker.author}</span> · {marker.label ?? "—"} · {timeAgo(marker.created_at)}
                  {marker.attachments.map((a, index) => (
                    <Badge key={index} className="ml-1.5">
                      {a.kind} {formatBytes(a.size_bytes)}
                    </Badge>
                  ))}
                </span>
                {marker.removed ? (
                  <Badge tone="danger">removed</Badge>
                ) : !marker.published ? (
                  <Badge tone="gold">draft</Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => act(getSupabase().rpc("admin_remove_annotation", { p_marker_id: marker.id, p_reason: "Removed by alpha admin" }), state.reload, "Note removed.")}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      }
    </Panel>
  );
}

function RoomsTab() {
  const state = useLoader(loadRooms);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel state={state}>
      {(rooms) =>
        rooms.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-faint">No rooms yet.</p>
        ) : (
          <ul className="space-y-3">
            {rooms.map((room) => {
              const activeMembers = room.members.filter((m) => m.status === "active");
              return (
                <li key={room.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-ink">{room.name}</span>
                          <Badge>{room.visibility}</Badge>
                          <Badge>{room.mode}</Badge>
                          {room.is_closed && <Badge tone="gold">closed</Badge>}
                          {room.archived_at && <Badge tone="gold">archived</Badge>}
                        </div>
                        <p className="mt-0.5 text-sm text-ink-soft">
                          {room.book_title} · owner {room.owner} · {room.notes} notes · {room.replies} replies · active {timeAgo(room.last_activity_at)}
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {activeMembers.map((m) => (
                            <li key={m.user_id}>
                              <Badge>
                                {m.display_name} · {formatPercent(m.furthest)}
                                {m.role !== "member" ? ` · ${m.role}` : ""}
                              </Badge>
                            </li>
                          ))}
                          {room.members.length > activeMembers.length && <li className="text-xs text-ink-faint">+{room.members.length - activeMembers.length} left / removed</li>}
                        </ul>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === room.id ? null : room.id)} aria-expanded={open === room.id}>
                          {open === room.id ? "Hide notes" : "Notes"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => act(getSupabase().rpc("admin_set_room_archived", { p_room_id: room.id, p_archived: !room.archived_at }), state.reload, room.archived_at ? "Room restored." : "Room archived.")}
                        >
                          {room.archived_at ? "Restore" : "Archive"}
                        </Button>
                      </div>
                    </div>
                    {open === room.id && (
                      <div className="mt-3 border-t border-line pt-2">
                        <p className="py-1 text-xs text-ink-faint">Where and by whom — never what a note says.</p>
                        <RoomMarkers roomId={room.id} />
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )
      }
    </Panel>
  );
}

// ---------------------------------------------------------------- books
const loadBooks = async () => {
  const { data, error } = await getSupabase().rpc("admin_list_books");
  return { data: data as AdminBook[] | null, error };
};

function BooksTab() {
  const state = useLoader(loadBooks);
  return (
    <Panel state={state}>
      {(books) =>
        books.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-faint">No books yet.</p>
        ) : (
          <TableCard>
            <thead>
              <tr>
                <Th>Book</Th>
                <Th>File</Th>
                <Th>Status</Th>
                <Th>Uploaded</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {books.map((book) => (
                <tr key={book.id}>
                  <Td>
                    <div className="font-medium text-ink">{book.title}</div>
                    <div className="text-xs text-ink-faint">{book.author ?? "Unknown author"} · in {book.rooms} rooms</div>
                  </Td>
                  <Td className="text-xs">
                    <div className="max-w-56 truncate" title={book.original_filename ?? undefined}>{book.original_filename ?? "—"}</div>
                    <div className="text-ink-faint">
                      {book.format.toUpperCase()} · {formatBytes(book.size_bytes)}
                      {book.page_count ? ` · ${book.page_count} pages` : ""}
                    </div>
                    {book.sha256 && <div className="font-mono text-[11px] text-ink-faint" title={book.sha256}>sha256 {book.sha256.slice(0, 12)}…</div>}
                  </Td>
                  <Td>
                    <Badge tone={book.status === "ready" ? "moss" : book.status === "failed" || book.status === "disabled" ? "danger" : "gold"}>{book.status}</Badge>
                    {book.error && <div className="mt-1 max-w-48 text-xs text-danger">{book.error}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {book.uploader}
                    <div className="text-ink-faint">{formatDate(book.created_at)}</div>
                  </Td>
                  <Td className="text-right">
                    {(book.status === "ready" || book.status === "disabled") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => act(getSupabase().rpc("admin_set_book_disabled", { p_book_id: book.id, p_disabled: book.status !== "disabled" }), state.reload, book.status === "disabled" ? "Book re-enabled." : "Book disabled.")}
                      >
                        {book.status === "disabled" ? "Re-enable" : "Disable"}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )
      }
    </Panel>
  );
}

// ---------------------------------------------------------------- feedback
const CATEGORY_LABEL: Record<string, string> = { bug: "Bug", confusing: "Confusing", idea: "Idea", love: "Love this" };

const loadFeedback = async () => {
  const supabase = getSupabase();
  const [feedback, profiles] = await Promise.all([
    supabase.from("alpha_feedback").select("id, user_id, category, message, route, room_id, book_id, context, status, created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, display_name"),
  ]);
  const names = new Map((profiles.data ?? []).map((p) => [p.id as string, p.display_name as string]));
  return { data: feedback.error ? null : { items: (feedback.data ?? []) as Feedback[], names }, error: feedback.error };
};

function FeedbackTab() {
  const state = useLoader(loadFeedback);
  const [filter, setFilter] = useState<string>("all");
  return (
    <Panel state={state}>
      {({ items, names }) => {
        const shown = items.filter((item) => filter === "all" || item.category === filter || item.status === filter);
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter feedback">
              {["all", "new", "bug", "confusing", "idea", "love"].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  aria-pressed={filter === option}
                  className={cn("h-9 rounded-full px-3.5 text-sm font-medium", filter === option ? "bg-accent-soft text-accent-ink" : "bg-sunk text-ink-soft hover:text-ink")}
                >
                  {option === "all" ? `All (${items.length})` : option === "new" ? `New (${items.filter((i) => i.status === "new").length})` : CATEGORY_LABEL[option]}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-faint">Nothing here yet.</p>
            ) : (
              <ul className="space-y-3">
                {shown.map((item) => (
                  <li key={item.id}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={item.category === "bug" ? "danger" : item.category === "love" ? "moss" : item.category === "idea" ? "accent" : "gold"}>{CATEGORY_LABEL[item.category] ?? item.category}</Badge>
                        <span className="text-sm font-medium text-ink">{names.get(item.user_id) ?? "Unknown"}</span>
                        <span className="text-xs text-ink-faint">{timeAgo(item.created_at)}</span>
                        <span className="ml-auto flex gap-1.5">
                          {item.status !== "done" && (
                            <Button size="sm" variant="ghost" onClick={() => act(getSupabase().from("alpha_feedback").update({ status: item.status === "new" ? "seen" : "done" }).eq("id", item.id), state.reload)}>
                              {item.status === "new" ? "Mark seen" : "Mark done"}
                            </Button>
                          )}
                          <Badge tone={item.status === "new" ? "gold" : item.status === "done" ? "moss" : "neutral"}>{item.status}</Badge>
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{item.message}</p>
                      <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-ink-faint">
                        {item.route ?? "—"}
                        {typeof item.context.location === "string" && ` · ${item.context.location}`}
                        {typeof item.context.progress === "number" && ` · ${formatPercent(item.context.progress)}`}
                        {typeof item.context.device === "string" && ` · ${item.context.device}`}
                        {typeof item.context.viewport === "string" && ` ${item.context.viewport}`}
                        {typeof item.context.theme === "string" && ` · ${item.context.theme}`}
                        {item.room_id && ` · room ${item.room_id.slice(0, 8)}`}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </Panel>
  );
}

// ---------------------------------------------------------------- errors & moderation log
const loadErrors = async () => {
  const supabase = getSupabase();
  const [errors, moderation, profiles] = await Promise.all([
    supabase.from("client_errors").select("id, user_id, route, message, stack, context, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("moderation_actions").select("id, room_id, actor_id, action, target_user_id, target_id, reason, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("profiles").select("id, display_name"),
  ]);
  const names = new Map((profiles.data ?? []).map((p) => [p.id as string, p.display_name as string]));
  return {
    data: errors.error ? null : { errors: (errors.data ?? []) as ClientError[], moderation: (moderation.data ?? []) as ModerationRow[], names },
    error: errors.error,
  };
};

function LogsTab() {
  const state = useLoader(loadErrors);
  return (
    <Panel state={state}>
      {({ errors, moderation, names }) => (
        <div className="space-y-8">
          <section>
            <h3 className="mb-3 font-display text-xl text-ink">Recent client errors</h3>
            {errors.length === 0 ? (
              <p className="text-sm text-ink-faint">No errors reported. </p>
            ) : (
              <ul className="space-y-2">
                {errors.map((error) => (
                  <li key={error.id}>
                    <details className="rounded-2xl border border-line bg-raised px-4 py-3">
                      <summary className="cursor-pointer text-sm text-ink">
                        <span className="font-medium">{error.message.slice(0, 140)}</span>
                        <span className="ml-2 text-xs text-ink-faint">
                          {error.route} · {error.user_id ? (names.get(error.user_id) ?? "unknown") : "—"} · {timeAgo(error.created_at)}
                        </span>
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-ink-soft">{error.stack ?? "No stack trace."}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-3 font-display text-xl text-ink">Moderation log</h3>
            {moderation.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing has been moderated.</p>
            ) : (
              <TableCard>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>Action</Th>
                    <Th>Target</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {moderation.map((row) => (
                    <tr key={row.id}>
                      <Td className="whitespace-nowrap text-xs">{timeAgo(row.created_at)}</Td>
                      <Td>{row.actor_id ? (names.get(row.actor_id) ?? "—") : "—"}</Td>
                      <Td className="font-mono text-[12px] text-ink">{row.action}</Td>
                      <Td className="text-xs">{row.target_user_id ? (names.get(row.target_user_id) ?? row.target_user_id.slice(0, 8)) : (row.target_id?.slice(0, 12) ?? "—")}</Td>
                      <Td className="text-xs">{row.reason ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableCard>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- shell
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "testers", label: "Testers" },
  { id: "access", label: "Access" },
  { id: "rooms", label: "Rooms" },
  { id: "books", label: "Books" },
  { id: "feedback", label: "Feedback" },
  { id: "logs", label: "Errors & log" },
];

export function AdminView({ meId }: { meId: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl text-ink">Alpha admin</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">Who&apos;s testing, what exists, and what people told us. Note contents are never shown here.</p>
      </div>
      <Tabs.Root defaultValue="overview">
        <Tabs.List aria-label="Admin sections" className="scroll-slim mb-6 flex gap-1 overflow-x-auto rounded-full bg-sunk p-1">
          {TABS.map((tab) => (
            <Tabs.Trigger
              key={tab.id}
              value={tab.id}
              className="h-10 shrink-0 rounded-full px-4 text-sm font-medium text-ink-soft transition-colors hover:text-ink data-[state=active]:bg-raised data-[state=active]:text-ink data-[state=active]:shadow-soft"
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview"><OverviewTab /></Tabs.Content>
        <Tabs.Content value="testers"><TestersTab meId={meId} /></Tabs.Content>
        <Tabs.Content value="access"><AccessTab /></Tabs.Content>
        <Tabs.Content value="rooms"><RoomsTab /></Tabs.Content>
        <Tabs.Content value="books"><BooksTab /></Tabs.Content>
        <Tabs.Content value="feedback"><FeedbackTab /></Tabs.Content>
        <Tabs.Content value="logs"><LogsTab /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
