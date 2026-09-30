"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/misc";
import type { RoomDetail } from "@/lib/types";
import type { ReaderBook } from "./reader-app";

// The reader is a purely client-side experience (it needs the window, local
// settings and the book engines), so it is never rendered on the server and its
// code — epub.js, PDF.js — is only downloaded when someone opens a book.
const ReaderApp = dynamic(() => import("./reader-app").then((module) => module.ReaderApp), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-paper" role="status">
      <Spinner className="size-6" label="Opening the book" />
    </div>
  ),
});

export function ReaderLoader({ room, book }: { room: RoomDetail; book: ReaderBook }) {
  return <ReaderApp room={room} book={book} />;
}
