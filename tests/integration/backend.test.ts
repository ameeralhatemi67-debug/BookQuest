import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUpload, type UploadProgress, type UploadState } from "@/lib/storage/upload";
import { MB } from "@/lib/limits";
import { anonClient, rpc, signUp, startBackend, syntheticBytes, syntheticPdf, waitFor, type Backend, type Tester } from "./helpers";

describe("backend integration (auth · data API · storage · realtime)", () => {
  let backend: Backend;
  let amir: Tester;
  let sara: Tester;
  let outsider: Tester;
  let bookId: string;
  let bookPath: string;
  let roomId: string;
  const pdfSize = 14 * MB + 12345; // > 2 TUS chunks
  let pdf: Blob;

  beforeAll(async () => {
    backend = await startBackend();
    amir = await signUp(backend, "Amir");
    sara = await signUp(backend, "Sara");
    outsider = await signUp(backend, "Outsider");
    pdf = syntheticPdf(pdfSize);
  });
  afterAll(async () => {
    for (const t of [amir, sara, outsider]) await t?.client.removeAllChannels();
    await backend?.close();
  });

  // ------------------------------------------------------------ auth
  describe("auth", () => {
    it("creates a profile and alpha access on sign-up", async () => {
      expect(await rpc(amir, "my_access")).toMatchObject({ status: "active", display_name: "Amir", is_admin: false });
    });

    it("leaves a tester without a code pending", async () => {
      const pending = await signUp(backend, "Pending", null);
      expect(await rpc(pending, "my_access")).toMatchObject({ status: "pending" });
      await expect(rpc(pending, "my_home")).rejects.toThrow("alpha_access_required");
      expect(await rpc(pending, "redeem_alpha_code", { p_code: "LOCAL-ALPHA" })).toMatchObject({ status: "active" });
    });

    it("signs in again with the password and rejects a wrong one", async () => {
      const client = anonClient(backend);
      const bad = await client.auth.signInWithPassword({ email: amir.email, password: "nope-nope" });
      expect(bad.error).toBeTruthy();
      const good = await client.auth.signInWithPassword({ email: amir.email, password: "correct horse battery" });
      expect(good.error).toBeNull();
      expect(good.data.user?.id).toBe(amir.id);
      const { data } = await client.auth.getUser();
      expect(data.user?.id).toBe(amir.id);
    });

    it("refuses everything to anonymous callers", async () => {
      const anon = anonClient(backend);
      expect((await anon.rpc("my_home")).error).toBeTruthy();
      const rooms = await anon.from("rooms").select("*");
      expect(rooms.error ?? (rooms.data?.length === 0 ? "empty" : null)).toBeTruthy();
      expect(rooms.data ?? []).toEqual([]);
    });
  });

  // ------------------------------------------------------------ uploads
  describe("large upload, direct to Storage", () => {
    const states: UploadState[] = [];
    const progress: UploadProgress[] = [];

    it("uploads a >14 MB book with the resumable protocol and real progress", async () => {
      const inserted = await amir.client
        .from("books")
        .insert({ uploader_id: amir.id, title: "Synthetic Large PDF", format: "pdf", original_filename: "large.pdf" })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();
      bookId = inserted.data!.id;
      bookPath = `${amir.id}/${bookId}/book.pdf`;
      await amir.client.from("books").update({ storage_path: bookPath }).eq("id", bookId);

      // On the emulator, drop the connection in the middle of two chunks: the
      // upload must recover on its own and still finish with every byte intact.
      await backend.chaos({ failNextPatches: 2 });

      const handle = startUpload({
        client: amir.client, bucket: "books", path: bookPath, file: pdf, contentType: "application/pdf",
        upsert: true, projectUrl: backend.url, apiKey: backend.key,
        onProgress: (p) => progress.push(p),
        onStateChange: (s) => states.push(s),
      });
      expect(handle.resumable).toBe(true);
      await handle.done;

      expect(states[0]).toBe("uploading");
      expect(states.at(-1)).toBe("done");
      if (backend.kind === "emulator") expect(states).toContain("retrying");
      // Progress is monotonic-ish, measured in real bytes, and ends at 100%.
      expect(progress.length).toBeGreaterThan(2);
      expect(progress.at(-1)).toMatchObject({ bytesSent: pdfSize, bytesTotal: pdfSize, fraction: 1 });
      expect(progress.some((p) => p.fraction > 0 && p.fraction < 1)).toBe(true);
    });

    it("produces valid storage metadata, confirmed by the server", async () => {
      const finalized = await rpc<{ size_bytes: number; mime_type: string }>(amir, "finalize_book_upload", { p_book_id: bookId });
      expect(finalized.size_bytes).toBe(pdfSize);
      expect(finalized.mime_type).toBe("application/pdf");
      await amir.client.from("books").update({ status: "ready", page_count: 10 }).eq("id", bookId);
      const { data } = await amir.client.from("books").select("status,size_bytes").eq("id", bookId).single();
      expect(data).toMatchObject({ status: "ready", size_bytes: pdfSize });
    });

    it("serves the stored bytes back intact, with HTTP range support", async () => {
      const signed = await amir.client.storage.from("books").createSignedUrl(bookPath, 120);
      expect(signed.error).toBeNull();
      const head = await fetch(signed.data!.signedUrl, { headers: { Range: "bytes=0-7" } });
      expect(head.status).toBe(206);
      expect(new TextDecoder().decode(await head.arrayBuffer())).toBe("%PDF-1.7");

      // A slice from deep inside the file (past the first two chunks) matches the source bytes.
      const start = 13 * MB;
      const slice = await fetch(signed.data!.signedUrl, { headers: { Range: `bytes=${start}-${start + 4095}` } });
      expect(slice.status).toBe(206);
      const got = new Uint8Array(await slice.arrayBuffer());
      const want = new Uint8Array(await pdf.slice(start, start + 4096).arrayBuffer());
      expect(got.length).toBe(4096);
      expect(Buffer.compare(Buffer.from(got), Buffer.from(want))).toBe(0);
    });

    it("refuses the file to unauthorized people, signed-in or not", async () => {
      expect((await outsider.client.storage.from("books").createSignedUrl(bookPath, 60)).error).toBeTruthy();
      expect((await outsider.client.storage.from("books").download(bookPath)).error).toBeTruthy();
      expect((await anonClient(backend).storage.from("books").download(bookPath)).error).toBeTruthy();
      const direct = await fetch(`${backend.url}/storage/v1/object/public/books/${bookPath}`);
      expect(direct.ok).toBe(false);
    });

    it("refuses uploads into someone else's folder, wrong types and oversized files", async () => {
      const evil = startUpload({
        client: outsider.client, bucket: "books", path: `${amir.id}/${bookId}/evil.pdf`, file: syntheticPdf(1024),
        contentType: "application/pdf", projectUrl: backend.url, apiKey: backend.key, forceResumable: true,
      });
      await expect(evil.done).rejects.toMatchObject({ code: "unauthorized" });

      const exe = new Blob([syntheticBytes(2048)], { type: "application/x-msdownload" });
      const bad = await amir.client.storage.from("avatars").upload(`${amir.id}/run.exe`, exe, { contentType: "application/x-msdownload" });
      expect(bad.error).toBeTruthy();

      const hugeAvatar = new Blob([syntheticBytes(11 * MB)], { type: "image/png" });
      const tooBig = startUpload({
        client: amir.client, bucket: "avatars", path: `${amir.id}/huge.png`, file: hugeAvatar,
        contentType: "image/png", projectUrl: backend.url, apiKey: backend.key,
      });
      await expect(tooBig.done).rejects.toMatchObject({ code: "too_large" });
    });

    it("can cancel a resumable upload cleanly", async () => {
      const states: UploadState[] = [];
      const handle = startUpload({
        client: amir.client, bucket: "books", path: `${amir.id}/${bookId}/cancelled.pdf`, file: syntheticPdf(13 * MB),
        contentType: "application/pdf", projectUrl: backend.url, apiKey: backend.key,
        onStateChange: (s) => states.push(s),
      });
      const settled = handle.done.catch((e) => e);
      await handle.cancel();
      expect(await settled).toMatchObject({ code: "cancelled" });
      expect(states.at(-1)).toBe("cancelled");
      expect((await amir.client.storage.from("books").createSignedUrl(`${amir.id}/${bookId}/cancelled.pdf`, 60)).error).toBeTruthy();
    });

    it("uploads small files with the standard endpoint", async () => {
      const png = new Blob([syntheticBytes(3000)], { type: "image/png" });
      const handle = startUpload({
        client: sara.client, bucket: "avatars", path: `${sara.id}/me.png`, file: png, contentType: "image/png",
        projectUrl: backend.url, apiKey: backend.key,
      });
      expect(handle.resumable).toBe(false);
      await handle.done;
      const { data } = sara.client.storage.from("avatars").getPublicUrl(`${sara.id}/me.png`);
      const fetched = await fetch(data.publicUrl);
      expect(fetched.status).toBe(200);
      expect((await fetched.arrayBuffer()).byteLength).toBe(3000);
    });
  });

  // ------------------------------------------------------------ the loop + realtime
  describe("the reading loop over the wire", () => {
    let note20: string;
    let note70: string;
    let channel: RealtimeChannel;
    const markerEvents: Record<string, unknown>[] = [];
    const contentEvents: Record<string, unknown>[] = [];
    const replyEvents: Record<string, unknown>[] = [];
    const progressEvents: Record<string, unknown>[] = [];

    it("creates a duo room and brings Sara in by invitation", async () => {
      roomId = await rpc<string>(amir, "create_room", { p_name: "Two readers", p_book_id: bookId, p_mode: "duo" });
      // Before joining, Sara cannot see the room or the book.
      expect((await sara.client.from("rooms").select("id").eq("id", roomId)).data).toEqual([]);
      expect((await sara.client.storage.from("books").createSignedUrl(bookPath, 60)).error).toBeTruthy();

      const invite = await rpc<{ token: string }>(amir, "create_invite", { p_room_id: roomId });
      expect(await rpc(sara, "preview_join", { p_token: invite.token })).toMatchObject({ state: "ok", room: { name: "Two readers" } });
      expect(await rpc(sara, "join_with_token", { p_token: invite.token })).toMatchObject({ status: "joined" });

      // Now she can open the book — and the outsider still cannot.
      expect((await sara.client.storage.from("books").createSignedUrl(bookPath, 60)).error).toBeNull();
      await expect(rpc(outsider, "join_with_token", { p_token: invite.token })).rejects.toThrow("invite_used_up");
    });

    it("subscribes Sara to the room over a private realtime channel", async () => {
      channel = sara.client
        .channel(`room:${roomId}`, { config: { private: true, presence: { key: sara.id } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "annotation_markers", filter: `room_id=eq.${roomId}` }, (p) => markerEvents.push(p.new as Record<string, unknown>))
        .on("postgres_changes", { event: "*", schema: "public", table: "annotation_contents", filter: `room_id=eq.${roomId}` }, (p) => contentEvents.push(p.new as Record<string, unknown>))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "annotation_replies", filter: `room_id=eq.${roomId}` }, (p) => replyEvents.push(p.new as Record<string, unknown>))
        .on("postgres_changes", { event: "*", schema: "public", table: "reading_progress", filter: `room_id=eq.${roomId}` }, (p) => progressEvents.push(p.new as Record<string, unknown>))
        // Presence is only enabled for a channel that registered a presence listener before subscribing.
        .on("presence", { event: "sync" }, () => {});
      await sara.client.realtime.setAuth();
      const status = await new Promise<string>((resolve) => channel.subscribe((s) => (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") && resolve(s)));
      expect(status).toBe("SUBSCRIBED");
      // Postgres Changes needs a moment to attach to the replication stream on a real stack.
      await new Promise((resolve) => setTimeout(resolve, backend.kind === "supabase" ? 3000 : 100));
    });

    it("refuses the room's private channel to a non-member", async () => {
      await outsider.client.realtime.setAuth();
      const ch = outsider.client.channel(`room:${roomId}`, { config: { private: true } });
      const status = await new Promise<string>((resolve) => ch.subscribe((s) => (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") && resolve(s)));
      expect(status).toBe("CHANNEL_ERROR");
      await outsider.client.removeChannel(ch);
    });

    it("delivers a neutral marker to Sara in real time — and none of the content", async () => {
      await rpc(amir, "save_progress", { p_room_id: roomId, p_position: 0.5, p_anchor: { type: "pdf", page: 5 }, p_label: "Page 5 of 10" });
      note20 = await rpc<string>(amir, "create_annotation", {
        p_room_id: roomId, p_position: 0.2, p_anchor: { type: "pdf", page: 2, y: 0.3 }, p_location_label: "Page 2", p_body: "SPOILER: secret twist",
      });
      note70 = await rpc<string>(amir, "create_annotation", {
        p_room_id: roomId, p_position: 0.7, p_anchor: { type: "pdf", page: 7, y: 0.1 }, p_location_label: "Page 7", p_emoji: "😱",
      });

      await waitFor(() => [note20, note70].every((id) => markerEvents.some((m) => m.id === id && m.published_at)), 15_000, "marker events");
      expect(markerEvents.map((m) => m.id)).toEqual(expect.arrayContaining([note20, note70]));
      expect(JSON.stringify(markerEvents)).not.toContain("SPOILER");
      await waitFor(() => progressEvents.length >= 1, 15_000, "progress event");

      // Give any (wrongly delivered) content event time to arrive, then assert there is none.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(contentEvents).toEqual([]);

      const { data: locked } = await sara.client.from("annotation_contents").select("*").eq("room_id", roomId);
      expect(locked).toEqual([]);
    });

    it("unlocks when Sara reaches the note, then carries the conversation live", async () => {
      const result = await rpc<{ unlocked: string[] }>(sara, "save_progress", {
        p_room_id: roomId, p_position: 0.2, p_anchor: { type: "pdf", page: 2 }, p_label: "Page 2 of 10",
      });
      expect(result.unlocked).toEqual([note20]);
      const { data: open } = await sara.client.from("annotation_contents").select("marker_id, body").eq("room_id", roomId);
      expect(open).toEqual([{ marker_id: note20, body: "SPOILER: secret twist" }]);

      await rpc(amir, "add_reply", { p_marker_id: note20, p_body: "told you" });
      await waitFor(() => replyEvents.length >= 1, 15_000, "reply event");
      expect(replyEvents[0]).toMatchObject({ marker_id: note20, body: "told you" });

      // Replies on the still-locked note never reach her.
      await rpc(amir, "add_reply", { p_marker_id: note70, p_body: "LOCKED reply" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(JSON.stringify(replyEvents)).not.toContain("LOCKED reply");
      const { data: replies } = await sara.client.from("annotation_replies").select("body").eq("room_id", roomId);
      expect(replies?.map((r) => r.body)).toEqual(["told you"]);
    });

    it("shows who is reading right now through presence", async () => {
      await amir.client.realtime.setAuth();
      const amirChannel = amir.client
        .channel(`room:${roomId}`, { config: { private: true, presence: { key: amir.id } } })
        .on("presence", { event: "sync" }, () => {});
      await new Promise<void>((resolve, reject) =>
        amirChannel.subscribe((s) => (s === "SUBSCRIBED" ? resolve() : s === "CHANNEL_ERROR" ? reject(new Error(s)) : undefined)),
      );
      await amirChannel.track({ user_id: amir.id, reading: true, progress: 0.5 });
      await channel.track({ user_id: sara.id, reading: true, progress: 0.2 });

      const seen = await waitFor(() => {
        const state = channel.presenceState<{ user_id: string; progress: number }>();
        return state[amir.id]?.[0] && state[sara.id]?.[0] ? state : null;
      }, 15_000, "presence state");
      expect(seen[amir.id][0]).toMatchObject({ user_id: amir.id, reading: true, progress: 0.5 });

      await amir.client.removeChannel(amirChannel);
      await waitFor(() => !channel.presenceState()[amir.id], 15_000, "presence leave");
    });

    it("keeps working through a dropped realtime connection", async () => {
      if (backend.kind !== "emulator") return;
      await backend.chaos({ disconnectRealtime: true });
      // Durable state is still served straight from Postgres while the socket is down…
      const detail = await rpc<{ members: unknown[] }>(sara, "room_detail", { p_room_id: roomId });
      expect(detail.members).toHaveLength(2);
      // …and the channel re-joins by itself and resumes delivering changes.
      const before = markerEvents.length;
      await waitFor(() => channel.state === "joined", 20_000, "channel rejoin");
      await rpc(amir, "create_annotation", { p_room_id: roomId, p_position: 0.9, p_anchor: { type: "pdf", page: 9 }, p_body: "after reconnect" });
      await waitFor(() => markerEvents.length > before, 15_000, "marker after reconnect");
    });
  });
});
