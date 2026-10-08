// The in-app "What's new" log: noteworthy releases only, newest first.
//
// Every change goes into CHANGELOG.md. When a batch of changes is worth
// telling testers about, add a release at the top of this list too. The
// dialog opens once for each new release id, then stays in the account menu.
// Write for readers, not developers: what they can now do, in one line each.

export type WhatsNewIcon =
  | "flip" | "attention" | "prediction" | "poll" | "package" | "map" | "lens" | "party" | "live" | "ritual"
  | "vault" | "away" | "weather" | "echo" | "desk" | "seats" | "note" | "music" | "rail" | "draw" | "book"
  | "room" | "share";

export interface WhatsNewItem {
  icon: WhatsNewIcon;
  title: string;
  body: string;
}

export interface WhatsNewRelease {
  /** Stable id; a new id is what makes the dialog open again. */
  id: string;
  /** ISO date the release reached testers. */
  date: string;
  title: string;
  summary: string;
  items: WhatsNewItem[];
}

export const WHATS_NEW: WhatsNewRelease[] = [
  {
    id: "2026-10-08-room-privacy-and-sharing",
    date: "2026-10-08",
    title: "Your room, your doors",
    summary: "Decide who can walk into your room, and tell a friend what's new.",
    items: [
      { icon: "room", title: "Switch a room between private and public", body: "The person who owns a room can open it to everyone or close it to invited friends only, any time, from Room settings. Readers already inside stay." },
      { icon: "share", title: "Share what's new", body: "Tap Share in the What's new window to send a friend a link to everything new. They can read it without an account." },
    ],
  },
  {
    id: "2026-10-07-emotional-multiplayer",
    date: "2026-10-07",
    title: "Reading together, with feelings",
    summary: "New ways to leave things for each other, and moments the whole room gets to share.",
    items: [
      { icon: "flip", title: "Pages turn like a book", body: "Pages now flip on their spine. Prefer scrolling? Switch to Scroll in reading settings." },
      { icon: "attention", title: "Five ways to get a friend's attention", body: "Notes can whisper, float, get excited, knock on the page, or yell DO NOT IGNORE THIS. Friends see how eager you are, never why." },
      { icon: "prediction", title: "Sealed predictions", body: "Seal a guess that opens at the next chapter, a point you choose, or the end. Nobody can change it, not even you." },
      { icon: "poll", title: "Polls hidden in the passage", body: "Ask the room something at an exact spot. Friends see it only when they get there, and the results once they vote." },
      { icon: "package", title: "Packages for one friend", body: "Wrap a message, voice note, photos, a drawing and a song for someone, to open when they reach that page." },
      { icon: "map", title: "The map", body: "See the whole book at once. Behind you, what friends left and how it felt. Ahead, only a glow." },
      { icon: "lens", title: "Read through a friend's eyes", body: "Tap the eye next to a friend on the progress rail to see only what they left." },
      { icon: "party", title: "Chapter afterparties", body: "When everyone finishes a chapter, everything left in it opens up together as a scrapbook." },
      { icon: "live", title: "Reading at the same time", body: "See when a friend is reading too, knock to say hello, or read together and watch each other move." },
      { icon: "ritual", title: "Room rituals", body: "Small challenges for the room, like everyone predicting before Chapter 8, or waiting for each other until Saturday." },
      { icon: "away", title: "While you were away", body: "Come back to a few sentences about what friends did, instead of a pile of notifications." },
      { icon: "weather", title: "Reaction weather", body: "Reach a page and see how it made the room feel. Never before you get there." },
      { icon: "vault", title: "The vault", body: "Finish the book to open everyone's predictions, ratings, the soundtrack and a replay of the whole journey." },
      { icon: "echo", title: "Echoes", body: "Reread a book and your old notes come back as you reach them." },
      { icon: "desk", title: "A reading desk at home", body: "Home now opens on the book you're in: who's where, what's waiting, and one button to keep reading." },
      { icon: "seats", title: "No more codes", body: "Anyone can join the alpha until all 75 seats are taken, and rooms now hold up to 75 readers." },
    ],
  },
  {
    id: "2026-10-01-living-notes",
    date: "2026-10-01",
    title: "Notes that come alive",
    summary: "The margins got livelier and the reader got more room.",
    items: [
      { icon: "attention", title: "Living note avatars", body: "A friend's note waits in the margin as their avatar. Tap to peek, double tap to reply, wiggle it to snooze." },
      { icon: "note", title: "Notes for one person", body: "Leave a note for the whole room, only yourself, or one friend." },
      { icon: "book", title: "Reading that counts", body: "Finishing now means actually reading the pages, not skipping to the end." },
      { icon: "rail", title: "A progress rail beside the page", body: "Everyone's place now sits in a slim rail on the left, so pages get the full height." },
    ],
  },
  {
    id: "2026-09-30-alpha-opens",
    date: "2026-09-30",
    title: "The alpha opens",
    summary: "Read one book with friends at your own pace, and leave things inside it for each other to find.",
    items: [
      { icon: "book", title: "Your books, your rooms", body: "Upload an EPUB or PDF, open a room and invite friends. Private, link-only or open." },
      { icon: "note", title: "Spoiler-safe notes", body: "Notes, photos, voice and video open only when a friend reaches the page you left them on." },
      { icon: "music", title: "A shared soundtrack", body: "Add music for the room, or cue a song to start when a friend reaches a page." },
      { icon: "draw", title: "Double tap to draw", body: "Double tap a passage to leave a note there, with a drawing if you like." },
    ],
  },
];

export const LATEST_RELEASE = WHATS_NEW[0];

/** Where a shared What's new link lands: a public page, readable without an account. */
export const WHATS_NEW_PATH = "/whats-new";

/** How many headline features the shared message lists before pointing at the link. */
const SHARE_HIGHLIGHTS = 4;

/**
 * The message a reader sends a friend. The title and text are written to stand
 * on their own (a chat app shows them above the link preview); the link is
 * kept separate so the share sheet can attach it natively.
 */
export function whatsNewShare(release: WhatsNewRelease, appName: string, origin: string) {
  const url = `${origin.replace(/\/$/, "")}${WHATS_NEW_PATH}`;
  const highlights = release.items.slice(0, SHARE_HIGHLIGHTS).map((item) => `• ${item.title}`);
  const more = release.items.length - highlights.length;
  const lines = [release.summary, "", ...highlights, ...(more > 0 ? [`…and ${more} more.`] : [])];
  return {
    title: `What's new in ${appName}: ${release.title}`,
    text: lines.join("\n"),
    url,
  };
}
