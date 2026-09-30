"use client";

import { BookOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BookCover } from "@/components/book-cover";
import { BookUploader } from "@/components/books/uploader";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { Badge, EmptyState, SectionHeading } from "@/components/ui/misc";
import { Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { friendlyError } from "@/lib/errors";
import { formatBytes, formatDate, plural } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import type { BookRow } from "@/lib/types";

export interface LibraryEntry extends BookRow {
  rooms: { id: string; name: string }[];
}

function EditBookDialog({ book, onClose }: { book: LibraryEntry; onClose: (changed: boolean) => void }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error: updateError } = await getSupabase()
      .from("books")
      .update({ title: title.trim(), author: author.trim() || null })
      .eq("id", book.id);
    setBusy(false);
    if (updateError) return setError(friendlyError(updateError));
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent title="Edit book details" description="Shown to everyone you read this book with.">
        <form onSubmit={submit} className="space-y-4">
          <FormError>{error}</FormError>
          <Field label="Title">{(props) => <Input {...props} value={title} maxLength={300} required onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Author">{(props) => <Input {...props} value={author} maxLength={300} onChange={(e) => setAuthor(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onClose(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!title.trim()}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBookDialog({ book, onClose }: { book: LibraryEntry; onClose: (changed: boolean) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    const { error: rpcError } = await supabase.rpc("delete_book", { p_book_id: book.id });
    if (rpcError) {
      setBusy(false);
      return setError(friendlyError(rpcError));
    }
    // Remove the bytes too. Best effort: the book is already unreadable for everyone.
    const base = `${book.uploader_id}/${book.id}`;
    await supabase.storage.from("books").remove([book.storage_path ?? `${base}/book.${book.format}`, `${base}/locations.json`]);
    await supabase.storage.from("covers").remove([`${base}/cover.jpg`]);
    setBusy(false);
    toast.success(`“${book.title}” was removed from your library.`);
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent title="Remove this book?" description={`“${book.title}” and its file will be deleted. Rooms you read it in alone will keep their notes but the book can no longer be opened.`}>
        <FormError>{error}</FormError>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onClose(false)}>
            Keep it
          </Button>
          <Button variant="danger" loading={busy} onClick={remove} icon={<Trash2 className="size-4" aria-hidden />}>
            Remove book
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BookItem({ book, onEdit, onDelete }: { book: LibraryEntry; onEdit: () => void; onDelete: () => void }) {
  const ready = book.status === "ready";
  return (
    <li id={book.id} className="flex gap-4 rounded-3xl border border-line bg-raised p-4 shadow-soft target:ring-2 target:ring-accent/50">
      <BookCover book={book} width={84} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-xl leading-tight text-ink">{book.title}</h3>
            <p className="truncate text-sm text-ink-soft">{book.author ?? "Unknown author"}</p>
          </div>
          <Menu>
            <MenuTrigger className="-mr-1.5 -mt-1.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink" aria-label={`Actions for ${book.title}`}>
              <MoreHorizontal className="size-5" aria-hidden />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={onEdit}>
                <Pencil className="size-4 text-ink-faint" aria-hidden /> Edit details
              </MenuItem>
              <MenuItem danger onSelect={onDelete}>
                <Trash2 className="size-4" aria-hidden /> Remove book
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge>{book.format.toUpperCase()}</Badge>
          <Badge>{formatBytes(book.size_bytes)}</Badge>
          {book.page_count ? <Badge>{plural(book.page_count, "page")}</Badge> : null}
          {book.status === "disabled" && <Badge tone="danger">Disabled by an admin</Badge>}
          {(book.status === "uploading" || book.status === "processing") && <Badge tone="gold">Upload not finished</Badge>}
          {book.status === "failed" && <Badge tone="danger">Upload failed</Badge>}
        </div>

        {!ready && book.status !== "disabled" && (
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            {book.error ? `${book.error}. ` : ""}Choose the same file again to pick the upload up where it stopped, or remove this entry.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
          {ready && (
            <Link href={`/rooms/new?book=${book.id}`} className={buttonClass("secondary", "sm")}>
              <Plus className="size-4" aria-hidden />
              Open a room
            </Link>
          )}
          {book.rooms.length > 0 ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-ink-soft">
              <BookOpen className="size-4 shrink-0 text-ink-faint" aria-hidden />
              {book.rooms.slice(0, 3).map((room, index) => (
                <span key={room.id} className="truncate">
                  <Link href={`/rooms/${room.id}`} className="underline-offset-4 hover:text-ink hover:underline">
                    {room.name}
                  </Link>
                  {index < Math.min(book.rooms.length, 3) - 1 ? "," : ""}
                </span>
              ))}
              {book.rooms.length > 3 && <span>+{book.rooms.length - 3}</span>}
            </span>
          ) : (
            ready && <span className="text-xs text-ink-faint">Added {formatDate(book.created_at)} · no rooms yet</span>
          )}
        </div>
      </div>
    </li>
  );
}

export function BooksView({ userId, books, autoUpload }: { userId: string; books: LibraryEntry[]; autoUpload?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<LibraryEntry | null>(null);
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl text-ink">My books</h1>
        <p className="mt-2 max-w-xl text-ink-soft">Books you&apos;ve uploaded. One book can be read in several rooms — with a friend, a small group, or both.</p>
      </div>

      <BookUploader userId={userId} autoOpen={autoUpload} onReady={() => router.refresh()} />

      <section aria-labelledby="library-heading">
        <SectionHeading id="library-heading" title="Library" hint={books.length > 0 ? plural(books.length, "book") : undefined} />
        {books.length === 0 ? (
          <EmptyState icon={<BookOpen className="size-5" aria-hidden />} title="Your shelf is empty">
            Add an EPUB or PDF above. Once it&apos;s ready you can open a room and invite someone to read it with you.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {books.map((book) => (
              <BookItem key={book.id} book={book} onEdit={() => setEditing(book)} onDelete={() => setDeleting(book)} />
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <EditBookDialog
          book={editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) router.refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteBookDialog
          book={deleting}
          onClose={(changed) => {
            setDeleting(null);
            if (changed) router.refresh();
          }}
        />
      )}
    </div>
  );
}
