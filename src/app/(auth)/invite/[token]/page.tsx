import type { Metadata } from "next";
import { BookCover } from "@/components/book-cover";
import { JoinButton } from "@/components/room/join-button";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { plural } from "@/lib/format";
import { roomMode } from "@/lib/room-modes";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { JoinPreview, JoinState } from "@/lib/types";

export const metadata: Metadata = { title: "Invitation" };

const PROBLEMS: Partial<Record<JoinState, { title: string; body: string }>> = {
  not_found: { title: "This invitation isn't valid", body: "The link may be mistyped or incomplete. Ask your friend to send it again." },
  revoked: { title: "This invitation was withdrawn", body: "The person who sent it has revoked it. Ask them for a new one." },
  expired: { title: "This invitation has expired", body: "Invitations last two weeks. Ask your friend for a fresh link." },
  used_up: { title: "This invitation has already been used", body: "It was good for a limited number of people. Ask your friend for a new one." },
  not_for_you: { title: "This invitation is for someone else", body: "It was made for a specific tester. Make sure you're signed in to the right account." },
};

const BLOCKED: Partial<Record<JoinState, string>> = {
  full: "This room is full right now.",
  closed: "This room isn't accepting new members right now.",
  archived: "This room has ended and was archived.",
  removed: "You were removed from this room. Ask the owner for a new invitation.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await requireAlpha(`/invite/${token}`);
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("preview_join", { p_token: token });
  const preview = (error ? { state: "not_found" } : data) as JoinPreview;

  const problem = PROBLEMS[preview.state];
  if (problem || !preview.room || !preview.book) {
    const info = problem ?? PROBLEMS.not_found!;
    return (
      <div className="text-center">
        <h1 className="text-3xl text-ink">{info.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{info.body}</p>
        <ButtonLink href="/home" variant="secondary" className="mt-6">
          Go to Home
        </ButtonLink>
      </div>
    );
  }

  const { room, book, inviter, members = [] } = preview;
  const mode = roomMode(room.mode);
  const blocked = BLOCKED[preview.state];

  return (
    <div className="flex flex-col items-center text-center">
      {inviter && (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Avatar person={inviter} size={28} />
          <span>
            <span className="font-medium text-ink">{inviter.display_name}</span> {preview.kind === "invite" ? "invited you to read" : "is reading"}
          </span>
        </p>
      )}
      {/* Non-members cannot load the private cover, so this shows the typographic one. */}
      <BookCover book={{ id: book.id, title: book.title, author: book.author }} width={116} className="mt-5" />
      <h1 className="mt-5 text-3xl leading-tight text-ink">{room.name}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        <span className="font-display italic">{book.title}</span>
        {book.author ? ` · ${book.author}` : ""}
      </p>
      {room.description && <p className="mt-3 text-sm leading-relaxed text-ink-soft">{room.description}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        <Badge tone="accent">{mode.name}</Badge>
        <Badge>{book.format.toUpperCase()}</Badge>
        <Badge>
          {plural(room.member_count, "reader")}
          {room.capacity < 50 ? ` of ${room.capacity}` : ""}
        </Badge>
      </div>
      {members.length > 0 && <AvatarStack people={members} size={30} max={6} className="mt-4" />}
      <p className="mt-4 text-sm leading-relaxed text-ink-soft">{mode.tagline}</p>

      <div className="mt-6 w-full">
        {preview.state === "already_member" ? (
          <ButtonLink href={`/rooms/${room.id}`} size="lg" className="w-full">
            You&apos;re already in — open the room
          </ButtonLink>
        ) : blocked ? (
          <>
            <p role="alert" className="rounded-xl border border-line bg-sunk px-4 py-3 text-sm text-ink-soft">
              {blocked}
            </p>
            <ButtonLink href="/home" variant="secondary" className="mt-4">
              Go to Home
            </ButtonLink>
          </>
        ) : (
          <JoinButton token={token} size="lg" className="w-full">
            Join and start reading
          </JoinButton>
        )}
      </div>
    </div>
  );
}
