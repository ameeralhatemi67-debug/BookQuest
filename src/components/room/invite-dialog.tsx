"use client";

import { Check, Copy, Link2, RefreshCw, Search, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/field";
import { Badge, Spinner } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { siteUrl } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { cn, timeAgo } from "@/lib/format";
import { VISIBILITY_INFO } from "@/lib/room-modes";
import { getSupabase } from "@/lib/supabase/client";
import type { Person, RoomDetail, RoomInvite } from "@/lib/types";

const inviteUrl = (token: string) => `${siteUrl()}/invite/${token}`;

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy automatically — select the link and copy it.");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} aria-label={label} className="font-mono text-[13px]" onFocus={(e) => e.currentTarget.select()} />
      <Button variant="secondary" onClick={copy} className="shrink-0" icon={copied ? <Check className="size-4 text-moss" aria-hidden /> : <Copy className="size-4" aria-hidden />}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function inviteState(invite: RoomInvite): { label: string; usable: boolean } {
  if (invite.revoked_at) return { label: "Revoked", usable: false };
  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) return { label: "Expired", usable: false };
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return { label: "Used", usable: false };
  return { label: invite.max_uses === null ? `${invite.use_count} joined` : `${invite.use_count} of ${invite.max_uses} used`, usable: true };
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <p className="text-sm leading-relaxed text-ink-soft">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function InviteDialog({ room, open, onOpenChange, onChanged }: { room: RoomDetail; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const supabase = getSupabase();
  const isStaff = room.my_role === "owner" || room.my_role === "moderator";
  const isOwner = room.my_role === "owner";
  const full = room.members.length >= room.capacity;

  const [invites, setInvites] = useState<RoomInvite[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [uses, setUses] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);

  const loadInvites = useCallback(async () => {
    if (!isStaff) return;
    const { data } = await supabase
      .from("room_invites")
      .select("id, room_id, token, created_by, invited_user_id, max_uses, use_count, expires_at, revoked_at, created_at")
      .eq("room_id", room.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setInvites((data ?? []) as RoomInvite[]);
  }, [isStaff, room.id, supabase]);

  useEffect(() => {
    if (open) {
      setError(null);
      setFresh(null);
      void loadInvites();
    }
  }, [open, loadInvites]);

  // Find testers by name to invite them directly.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setPeople([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("search_all", { p_query: term });
      const memberIds = new Set(room.members.map((m) => m.user_id));
      setPeople((((data as { people?: Person[] } | null)?.people ?? []) as Person[]).filter((p) => !memberIds.has(p.id)));
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, room.members, supabase]);

  async function createLink() {
    setBusy("create");
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_invite", { p_room_id: room.id, p_max_uses: uses === 0 ? null : uses, p_expires_in_days: 14 });
    setBusy(null);
    if (rpcError) return setError(friendlyError(rpcError));
    setFresh((data as { token: string }).token);
    void loadInvites();
  }

  async function inviteTester(person: Person) {
    setBusy(person.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc("create_invite", { p_room_id: room.id, p_invited_user_id: person.id });
    setBusy(null);
    if (rpcError) return setError(friendlyError(rpcError));
    toast.success(`${person.display_name} will find the invitation in their notifications.`);
    setQuery("");
    void loadInvites();
  }

  async function revoke(invite: RoomInvite) {
    setBusy(invite.id);
    const { error: rpcError } = await supabase.rpc("revoke_invite", { p_invite_id: invite.id });
    setBusy(null);
    if (rpcError) return setError(friendlyError(rpcError));
    if (fresh === invite.token) setFresh(null);
    void loadInvites();
  }

  async function rotate() {
    setBusy("rotate");
    const { error: rpcError } = await supabase.rpc("rotate_join_code", { p_room_id: room.id });
    setBusy(null);
    if (rpcError) return setError(friendlyError(rpcError));
    toast.success("New room link created. The old one no longer works.");
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Invite readers" description={`${room.name} is ${VISIBILITY_INFO[room.visibility].name.toLowerCase()}. ${VISIBILITY_INFO[room.visibility].description}`}>
        <div className="space-y-7">
          <FormError>{error}</FormError>
          {room.is_closed && <FormError>This room is closed to new members. Re-open it in settings before inviting anyone.</FormError>}
          {full && !room.is_closed && <FormError>This room is full ({room.capacity} readers). Raise the limit in settings to invite more people.</FormError>}

          {room.join_code && (
            <Section title="Room link" hint="Anyone in the alpha who has this link can join. Share it however you like.">
              <CopyField value={inviteUrl(room.join_code)} label="Room link" />
              {isOwner && (
                <button type="button" onClick={rotate} disabled={busy === "rotate"} className="inline-flex items-center gap-1.5 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline">
                  <RefreshCw className={cn("size-3.5", busy === "rotate" && "animate-spin")} aria-hidden />
                  Replace with a new link
                </button>
              )}
            </Section>
          )}

          {isStaff ? (
            <>
              <Section title="Invitation link" hint="A personal link that stops working once it has been used. Valid for 14 days.">
                {fresh ? (
                  <div className="animate-fade-up space-y-2">
                    <CopyField value={inviteUrl(fresh)} label="New invitation link" />
                    <p className="text-sm text-ink-soft">Send this to the person you want to read with. They&apos;ll be asked to sign in or create an account first.</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-ink-soft">
                      Good for
                      <select
                        value={uses}
                        onChange={(e) => setUses(Number(e.target.value))}
                        className="h-10 rounded-xl border border-line-strong bg-raised px-2.5 text-sm text-ink"
                        disabled={room.mode === "duo"}
                      >
                        <option value={1}>1 person</option>
                        <option value={5}>5 people</option>
                        <option value={0}>any number</option>
                      </select>
                    </label>
                    <Button onClick={createLink} loading={busy === "create"} icon={<Link2 className="size-4" aria-hidden />}>
                      Create invitation link
                    </Button>
                  </div>
                )}
                {fresh && (
                  <button type="button" className="text-sm text-accent-ink underline-offset-4 hover:underline" onClick={() => setFresh(null)}>
                    Create another
                  </button>
                )}
              </Section>

              <Section title="Invite a tester by name" hint="They'll get a notification with an invitation only they can use.">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search alpha testers" aria-label="Search alpha testers" className="pl-10" />
                </div>
                {query.trim().length >= 2 && (
                  <ul className="rounded-2xl border border-line">
                    {searching ? (
                      <li className="flex justify-center p-3">
                        <Spinner />
                      </li>
                    ) : people.length === 0 ? (
                      <li className="p-3 text-sm text-ink-faint">No testers found with that name.</li>
                    ) : (
                      people.map((person) => (
                        <li key={person.id} className="flex items-center gap-3 border-b border-line p-2.5 last:border-b-0">
                          <Avatar person={person} size={32} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{person.display_name}</span>
                          <Button size="sm" variant="secondary" loading={busy === person.id} onClick={() => inviteTester(person)} icon={<UserPlus className="size-4" aria-hidden />}>
                            Invite
                          </Button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </Section>

              <Section title="Invitations sent">
                {invites === null ? (
                  <Spinner />
                ) : invites.length === 0 ? (
                  <p className="text-sm text-ink-faint">None yet.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-2xl border border-line">
                    {invites.map((invite) => {
                      const state = inviteState(invite);
                      const target = invite.invited_user_id ? room.people.find((p) => p.user_id === invite.invited_user_id)?.display_name : null;
                      return (
                        <li key={invite.id} className="flex items-center gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-ink">
                              {invite.invited_user_id ? `For ${target ?? "a specific tester"}` : `Link …${invite.token.slice(-6)}`}
                            </p>
                            <p className="text-xs text-ink-faint">Created {timeAgo(invite.created_at)}</p>
                          </div>
                          <Badge tone={state.usable ? "moss" : "neutral"}>{state.label}</Badge>
                          {state.usable && (
                            <>
                              {!invite.invited_user_id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Copy invitation link"
                                  onClick={async () => {
                                    await navigator.clipboard.writeText(inviteUrl(invite.token)).catch(() => {});
                                    toast.success("Invitation link copied.");
                                  }}
                                >
                                  <Copy className="size-4" aria-hidden />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" aria-label="Revoke invitation" loading={busy === invite.id} onClick={() => revoke(invite)}>
                                {busy !== invite.id && <Trash2 className="size-4" aria-hidden />}
                              </Button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </>
          ) : (
            !room.join_code && <p className="text-sm leading-relaxed text-ink-soft">This is a private room: only the owner and moderators can invite people. Ask them to send an invitation.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
