# BookQuest architecture

Next.js App Router serves authenticated pages and loads room/book metadata. Supabase SSR manages cookies and refreshes sessions through `src/proxy.ts`. Client components use a publishable key and the current user's JWT. Authorization lives in Postgres RLS and narrowly granted security-definer RPCs; page guards provide navigation convenience.

## Reading and storage

EPUB.js renders sandboxed book content and uses CFI anchors plus generated locations for progress. PDF.js renders nearby pages and stores page numbers with normalized selection rectangles. Reader position and furthest reach are separate: going back does not lock discoveries again. Settings persist locally. Progress queues locally during a dropped connection and retries after reconnection.

Books and media travel directly from the browser to Supabase Storage. Small uploads use the standard API; large uploads use TUS in 6 MB chunks with pause/resume, cancellation and retry. Client inspection recognizes EPUB/PDF, extracts metadata, hashes files and generates cover/location assets. Database finalization checks stored metadata before marking an upload ready. Binary files do not pass through Vercel functions.

Books, annotation media and soundtracks use private buckets; avatars are public profile pictures. Book access requires the uploader or permitted room membership. Signed URLs remain usable until expiry, even after access is revoked; this alpha does not provide instant revocation of already-issued URLs. EPUB bytes may also remain in a reader's browser cache.

## Rooms and spoiler protection

Rooms are private, unlisted or open; invitations, limits, membership roles and archiving are enforced through RPCs. Chill, Race and Private Duo modes share the same reading engine.

Annotation markers expose neutral location/author information. Content, replies, reactions and attachment access are separately protected until the user's saved furthest reach unlocks the marker. Authors can see their own notes. Unlock state is durable. Admin tools show metadata and moderation actions, not a feed of private note contents.

Soundtracks follow the same principle: `soundtrack_tracks` and the private `soundtracks` bucket check membership and saved progress. Uncued tracks form a room playlist. Cued titles and bytes remain inaccessible until reached, except to their author. Uploads use draft → stored → ready finalization; removal deletes Storage bytes before the database row. A room holds at most 100 tracks, including unfinished drafts.

The reader uses native audio. Automatic cues require explicit opt-in each reading session and play once per session when their page is visible. Skipping ahead does not play every skipped cue. Hiding the player keeps playback running; Stop disarms automatic cues. Mobile autoplay restrictions are surfaced with a Play prompt.

## Freshness and recovery

One private Realtime channel carries presence and filtered row-change hints for a room. Presence is ephemeral; durable state is fetched from Postgres. The channel resyncs after its first subscription to close the initial fetch/subscription gap, and after reconnecting. While disconnected, the app polls at a restrained interval and refetches on tab return.

Feedback records route, room, location, device and viewport context without automatically copying book text or note contents. The admin area manages alpha access, rooms, books, feedback and error/moderation logs. Two provisioned owners operate the closed alpha.

## UI foundations

The existing warm paper, terracotta and serif identity continues throughout the app. The reader adds a quiet desk around the page, adaptive typography, light/sepia/dark palettes, focus mode, safe-area spacing, 44 px reader controls and clear hover/pressed/loading/disabled states. Native text selection supplies the long-press interaction on touch devices. Motion is restrained and respects reduced-motion preferences.

The work used Impeccable's design guidance and Vercel's implementation/verification guidance. 21st.dev component search required a separate sign-in; no fetched component was added. Existing Radix primitives and native controls cover the implemented interactions.

## Development backend

The local emulator runs real application migrations and RLS in PGlite, with small adapters for Auth, REST, Storage/TUS and Realtime. Its control endpoints and development JWTs are unsuitable for hosting. Local tests do not prove every managed Supabase behavior; production smoke checks and physical devices complement them.
