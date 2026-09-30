# Shared Reading Experience — Idea Seed

> **Working document:** `idea_seed.md`  
> **Purpose:** Preserve the original product idea and the principles behind it before research, architecture, product planning, or implementation begins.  
> **Status:** Early concept / idea seed  
> **Date:** 2026-09-30

---

## 1. Original Idea

The project begins as a website for testing a new kind of shared reading experience.

A user uploads a book, opens a private reading space, and invites one or more friends. Everyone can read the same book through the website while the system tracks their individual progress.

The core idea is that reading becomes a shared experience without requiring everyone to read at the same time.

Readers can leave notes, reactions, media, and discussions directly inside the book. These can contain:

- Short text reactions
- Long-form thoughts
- Images
- Videos
- Voice notes
- Links
- Highlights
- Other media or attachments

The important difference is that these notes are connected to **specific places in the book**.

A friend who has not yet reached that part of the book should not immediately see what the note contains. Instead, they can see that someone has left something there — like a pin, marker, or trace — creating anticipation without spoiling the content.

When they eventually reach that location, they can open the note and discover what their friend wrote, watched, recorded, or reacted to at that exact moment.

The experience should feel social, playful, motivating, and alive rather than like a traditional ebook reader with comments added on top.

---

# 2. Product Thesis

The strongest interpretation of the idea is not:

> “A website where people discuss books.”

It is:

> **The book itself becomes a multiplayer space.**

Friends are not merely chatting about a book in a separate discussion page. They are leaving pieces of themselves inside another reader's future journey through the book.

The product should create the feeling that:

> **Your friends are inside the book with you.**

Even when everyone is reading at different times.

This is fundamentally an **asynchronous shared experience**.

One person might read a chapter on Tuesday and leave a reaction.

Another person reaches the same passage on Friday.

Yet when they discover that reaction, it can feel as though the first reader is there with them at that exact moment.

That emotional experience is the heart of the product.

---

# 3. Core Product Loop

The first version should obsess over one loop:

> **Upload → Create Room → Invite → Read → See Progress → Leave Something → Friend Reaches It → Reveal → Reply → Continue Reading**

More explicitly:

1. A user uploads a book.
2. They create a private reading room.
3. They invite one or more friends.
4. Everyone begins reading through the website.
5. The system automatically tracks each person's reading progress.
6. Readers can see where their friends are in the book.
7. A reader can leave a note/reaction attached to a passage or position.
8. Friends who have not reached it can see that something exists there, but not its contents.
9. When a friend reaches that location, the note becomes discoverable.
10. They open it, react, or reply.
11. The conversation becomes attached to that exact moment in the book.
12. Reading continues.

The desired reward cycle is:

> **Read → Progress → Discover → React → Continue**

This should feel substantially better than:

> Read → Leave the book → Open a group chat → Search for the discussion → Avoid spoilers → Reply → Return to the book

---

# 4. Why the Idea Could Be Special

The product sits near several familiar categories:

- Ebook readers
- Annotation tools
- Book clubs
- Reading trackers
- Social reading apps
- Messaging apps

But the goal is not simply to combine those products.

The differentiation should come from making **discovery inside the reading journey** the central interaction.

The product should not primarily feel like:

- Goodreads with comments
- Discord for books
- A normal EPUB reader with annotations
- A leaderboard attached to reading

Instead, it should feel like a shared journey through a book.

Possible positioning language:

> **Experience a book together.**

> **Your friends are inside the book with you.**

> **Leave something for them to discover.**

The last statement captures one of the most distinctive emotional mechanics of the product.

---

# 5. Spoiler-Protected Social Notes

This is one of the most important mechanics.

Suppose a friend has already reached page/chapter/location 143 and leaves a note.

A reader who is only at location 90 should be able to see that something exists later in the book, but should not see:

- The note text
- The reaction emoji
- The image
- The video thumbnail
- The voice transcript
- The discussion
- Anything that could reveal what happens

Instead, the interface might simply say:

> **Sara left something here.**

or show a subtle marker/avatar.

This creates anticipation.

The reader knows that a friend reacted strongly enough to leave something, but they don't know why.

When the reader reaches that exact point, the marker unlocks.

This moment should be treated as one of the product's signature interactions.

---

# 6. Reading Trails

A possible signature concept is **Reading Trails**.

Every person leaves a trail through the book as they read.

A trail can contain:

- Reactions
- Notes
- Highlights
- Questions
- Images
- Voice messages
- Videos
- Links
- Discussions

Readers ahead of you have effectively left small traces of their experience behind.

You can see that those traces exist without necessarily seeing what they contain.

Example:

```text
Chapter 8

◌
◌
● Sara
◌
● Ahmed
◌
◌
```

The interface tells the reader that Sara and Ahmed left something in this chapter.

It does not reveal what.

As the reader progresses, those hidden pieces of the trail become available.

This turns reading into a sequence of discoveries.

---

# 7. Social Progress

Seeing each other's progress should be a major part of the experience.

Example:

```text
Ahmed   68%
Sara    51%
You     32%
Khalid  19%
```

A more visual representation might use the book itself as a track:

```text
START ━━━ 🟢 You ━━━━ 🔵 Sara ━━━ 🔒 ━━━ 🟣 Fahad ━━━ END
```

The goal is not simply to display percentages.

The progress system should create the feeling that everyone is moving through the same world.

Possible interactions include:

- Friend avatars positioned along a book progress line
- Chapter-level progress
- “Last read” indicators
- Gentle milestones
- Friends currently reading
- Someone just passing your current position
- Someone catching up to you
- Someone finishing a chapter

However, the design should avoid making reading stressful or overly competitive by default.

---

# 8. Room Modes

Different groups may want very different experiences.

The product can eventually support **Room Modes**.

| Mode | Purpose |
|---|---|
| **Chill** | Read at any pace and naturally discover friends' notes. |
| **Race** | Progress, milestones, friendly competition, and catching up become more visible. |
| **Book Club** | Structured chapters, schedules, prompts, and group discussions. |
| **Study** | Highlights, references, structured notes, questions, and research resources. |
| **Private Duo** | A more intimate experience built around two readers. |
| **Live Read** | Multiple people read together during the same session. |

Room modes should primarily change the **social experience and emphasis**, not fragment the underlying reader into completely different products.

Competition should be optional.

Some readers will be motivated by:

> “Sara is already at 72%. I need to catch up.”

Others will find that stressful.

The product should accommodate both.

---

# 9. Signature In-Reader Interaction

One possible “wow” interaction:

A reader reaches a passage.

A friend's small avatar or marker appears quietly in the margin.

No modal interrupts the reading experience.

The reader taps the marker.

The text shifts slightly and a card opens from the side.

Example:

```text
Sara · left this 3 days ago

“I have a theory about this character…”

🎙 Voice note · 0:36

Reply
```

The reader can respond without losing their place.

The note then becomes a small conversation attached permanently to that location in the book.

This interaction should feel natural enough that users begin associating it specifically with the product.

---

# 10. Notes and Media

Notes should eventually support multiple formats.

Possible note types:

- Plain text
- Emoji reaction
- Highlight + comment
- Image
- GIF
- Voice note
- Video
- Link
- Poll
- Drawing / doodle
- Question
- Threaded discussion

However, the interface should remain simple.

A passage selection might initially expose only:

```text
Highlight · React · Note
```

Opening **Note** can then reveal richer media options.

The reading interface should never feel like a content-creation dashboard.

Reading remains primary.

---

# 11. Notes Can Have Different Sizes

A note does not always need to be a tiny comment bubble.

Some notes might contain:

- One emoji
- One sentence
- A paragraph
- Several paragraphs
- Multiple images
- A video
- A long discussion
- External references

Therefore, notes can have different presentation levels.

### Small Note

Displayed directly beside the passage or in a compact popover.

### Expanded Note

Opens into a larger side panel.

### Full Discussion

Can temporarily become a dedicated side page/panel while preserving the reading position.

This prevents large discussions from overwhelming the book layout.

---

# 12. Micro-Interactions and Game Feel

The website should feel playful and responsive without turning reading into a noisy game.

Potential micro-interactions:

- A marker gently appearing when a note unlocks
- Progress bars smoothly moving when a user finishes a section
- Friend avatars subtly advancing through the book
- A satisfying animation when catching up to another reader
- A small pulse when someone has left something nearby
- Chapter-completion transitions
- Unlock animations for hidden notes
- Tiny celebration when everyone completes a chapter
- Subtle activity indicators when another member is currently reading

The design goal is:

> **Make progress emotionally visible.**

The user should feel that reading produces movement.

---

# 13. Gamification Philosophy

Gamification should support reading rather than replace it.

Good forms of gamification may include:

- Shared progress
- Reading streaks within a room
- Chapter milestones
- Group completion goals
- Friendly catch-up indicators
- Hidden discoveries
- Journey statistics
- Optional race mode
- Shared achievements

Avoid making the experience primarily about:

- XP farming
- Constant badges
- Aggressive notifications
- Artificial daily obligations
- Punishment for missing days
- Public status competition

The most powerful “reward” should be:

> **I want to continue because something or someone is waiting for me deeper in the book.**

---

# 14. Completed Book → The Journey

A reading room should not become useless when everyone finishes the book.

Instead, it can transform into a memory of the experience.

Working concept: **The Journey**.

Example:

# Our Journey Through *Dune*

**23 days reading together**

```text
Amir   ━━━━━━━━━━━━ 100%
Sara   ━━━━━━━━━━━━ 100%
Fahad  ━━━━━━━━━━━━ 100%
```

Statistics could include:

- Total notes
- Total highlights
- Discussions
- Voice notes
- Images shared
- Most discussed chapter
- Most discussed passage
- First person to finish
- Moments where everyone reacted
- Reading duration
- Group milestones

The system could then generate a timeline.

Example:

### Chapter 2
Sara posted the group's first theory.

### Chapter 7
Everyone discussed the same character.

### Chapter 11
This became the most discussed section of the book.

### Chapter 16
Amir discovered a note Fahad had left nine days earlier.

The finished book becomes something closer to a **digital scrapbook of the shared reading experience**.

This gives rooms emotional value after completion.

---

# 15. Product Personality

The product should feel:

- Warm
- Personal
- Social
- Curious
- Playful
- Calm
- Modern
- Intimate
- Focused on reading

It should **not** feel primarily like:

- Social media
- A productivity system
- A school LMS
- A competitive fitness tracker
- A generic chat application

The interface should generally disappear while reading and come alive only when something meaningful happens.

---

# 16. Existing Products and Validation

Several existing products already prove that there is demand for pieces of this behavior.

Examples worth researching further include:

### StoryGraph — Buddy Reads

StoryGraph has implemented spoiler-protected buddy-read reactions where comments become available based on reading progress.

This strongly validates the idea that readers value asynchronous, spoiler-safe reactions.

### Fable

Fable combines interactive ebooks, book clubs, reactions, discussions, notes, and social reading.

### Literal

Literal includes private/public book clubs, member progress, scheduling, discussions, and spoiler-aware chapter conversations.

### Pagebound

Pagebound combines social book discussion with progress-linked posts and more explicit gamification elements.

### Bookship

Bookship explores reading groups, rich posts, links, images, and book-focused social experiences.

### Hypothesis

Hypothesis is useful as a reference for precise passage-anchored annotations and discussions.

These products should be treated primarily as **evidence that individual parts of the idea are useful**, not as templates that the project must copy.

The project's strongest opportunity is combining these behaviors around a different core philosophy:

> **The book is the shared space.**

---

# 17. Prototype Scope

The first prototype should intentionally be small.

The goal is **not** to prove that we can build a complete reading platform.

The goal is to answer:

> **Does the shared-reading loop actually feel special when people use it?**

The prototype should focus on five areas.

## 17.1 Library / Home

Shows:

- Current books
- Active rooms
- Basic progress
- Continue reading

## 17.2 Reading Room

Shows:

- Book information
- Members
- Each member's progress
- Activity
- Continue reading

## 17.3 Reader

Provides:

- Book rendering
- Automatic progress tracking
- Friends' location/progress
- Note markers
- Hidden/unlocked note behavior

## 17.4 Note Panel

Supports initially:

- Text
- Image
- Link
- Voice note
- Possibly video
- Replies

## 17.5 Completed Journey

Provides a basic recap of:

- Reading progress
- Shared notes
- Important moments
- Group statistics

---

# 18. What NOT to Build Yet

The first prototype should avoid unnecessary platform expansion.

Do not prioritize:

- Public book discovery
- Goodreads-style ratings
- Recommendation engines
- Public social profiles
- Large public communities
- Author pages
- Book marketplace
- AI summaries
- AI-generated discussion prompts
- Complex achievements
- Monetization
- Publisher integrations
- Mobile applications

These may become useful later, but they are not required to validate the core idea.

---

# 19. Upload Any Book — Prototype Decision

The long-term copyright and licensing implications of allowing users to upload books must be taken seriously before the product is released publicly.

However, **this is not currently a public product**.

For the private prototype/testing phase, we will keep the “upload a book” concept so we can explore and validate the experience without prematurely designing the product around distribution/licensing constraints.

### Current Decision

> Keep book upload in the prototype.

### Legal / Product Note

Before the project becomes publicly accessible — and especially before commercial launch or an app release — we must revisit:

- Copyright law
- User-uploaded copyrighted works
- Sharing uploaded books between users
- Storage and reproduction rights
- Publisher licensing
- DRM considerations
- Terms of service
- Takedown processes
- Regional legal requirements

A likely long-term architecture may require every participant to provide or verify access to their own copy while the platform synchronizes only:

- Reading positions
- Annotations
- Notes
- Discussions
- Social metadata

Another option may involve licensed catalogs or publisher integrations.

**This issue is explicitly deferred, not ignored.**

It becomes a required research/legal checkpoint before any public launch.

---

# 20. Book Formats

Initial technical exploration should focus on:

- EPUB
- PDF

EPUB is particularly suitable for a native reading experience because its text can reflow based on:

- Screen size
- Font size
- Font choice
- Line spacing
- Reader preferences

PDF is useful because users already have many books and documents in this format, although annotation anchoring behaves differently.

---

# 21. Do Not Store Notes by Visible Page Number Alone

A critical technical principle:

> **Notes should be attached to semantic/document locations, not merely displayed page numbers.**

In EPUB, “page 143” is not stable.

Changing:

- Device
- Window size
- Font size
- Font family
- Line spacing

can completely change the visible page count.

Therefore, EPUB annotations should eventually use stable anchors such as:

- EPUB CFI
- Chapter/section identifiers
- Text fragments
- Selected ranges
- Context fingerprints

Conceptually:

```text
Book
└── Chapter
    └── Exact text/location anchor
        └── Note
```

For PDF, anchors can use information such as:

```text
Book
└── Page
    └── Text selection / coordinates
        └── Note
```

This becomes one of the most important technical foundations of the project.

---

# 22. Progress Tracking

Progress should happen automatically whenever possible.

Possible measurements include:

- EPUB location percentage
- Current chapter
- Stable reading-location index
- PDF page + scroll/position

The system should avoid requiring readers to manually enter:

> “I'm on page 173.”

The application should know where they stopped.

Progress can then power:

- Friend locations
- Spoiler protection
- Note unlocking
- Milestones
- Room activity
- Finished-book journeys

---

# 23. Spoiler Protection Must Be Built Into the Data Model

Spoiler protection should not be treated only as a visual UI trick.

The system needs to understand:

- Where a note exists
- Where each reader currently is
- Whether a reader has reached the note
- Whether they intentionally reveal something early
- Whether the note applies to a passage, chapter, or larger region

This affects both the front end and the underlying permissions/query logic.

Later designs should consider whether users can optionally:

- Reveal a hidden note early
- Hide all future markers
- See only the number of future notes
- See which friend left the marker
- Hide the friend's identity until discovery

These could create different spoiler-protection levels.

---

# 24. Possible Future “Wow” Features

These are ideas to preserve for later exploration, not immediate MVP requirements.

### Ghost Presence

See a subtle indication that a friend is currently reading the same chapter.

### “They Were Here” Moments

When entering a chapter, see that several friends previously passed through it.

### Synchronized Live Reading

Friends read together in real time with presence indicators.

### Time Capsules

Leave a message that only unlocks once the reader reaches a specific future location.

### Prediction Notes

Make a prediction that becomes locked after submission and can be revisited when the relevant part of the story is reached.

### Group Prediction Board

Compare everyone's theories without exposing later information.

### Private Notes vs Shared Notes

A user can maintain both a personal annotation layer and a room-visible layer.

### Multiple Rooms for One Book

A user could read the same book with:

- A friend
- A study group
- A public club

while maintaining separate conversations.

### Emotional Reactions

Quick reactions could help form a visual “emotional map” of the book after completion.

### Journey Replay

After finishing, replay how the group moved through the book over time.

### Book Heatmap

Show where the most conversation occurred after the user has safely finished those sections.

### Gifts Inside Books

A reader can intentionally prepare something for another person to discover later.

This reinforces the idea that reading is not just consumption — it can become a shared memory.

---

# 25. Questions to Explore Later

These are intentionally unanswered at the idea-seed stage.

## Product

- How much should users know about future notes?
- Can seeing many future markers itself become a spoiler?
- Should a reader know who left the note before opening it?
- Should notes automatically unlock or require tapping?
- What should happen when two users highlight slightly different text around the same passage?
- How should very large discussions behave inside the reader?
- How competitive should progress feel by default?
- What makes someone return every day without creating unhealthy pressure?

## Reading Experience

- Paginated reader vs continuous scrolling?
- Should users customize fonts and themes?
- How much UI can appear without damaging reading focus?
- How should notes behave on mobile?
- How do we make multimedia notes feel native rather than distracting?

## Social

- Maximum useful room size?
- Should rooms support roles or moderators?
- What happens if someone joins halfway through?
- Can people reread a book without exposing everything immediately?
- Should a room have a chat outside the book at all?

## Technical

- EPUB parsing/rendering strategy
- PDF anchoring reliability
- Book identity and edition matching
- Annotation anchor resilience when files differ slightly
- Media storage
- Realtime presence
- Progress synchronization
- Offline reading
- Search
- Notifications

## Legal / Platform

- Copyright and private uploads
- Public sharing
- Publisher relationships
- DRM
- App Store / Play Store implications
- User-generated content moderation
- Content takedown mechanisms

---

# 26. Principles We Should Protect

As the project grows, features will accumulate and the original idea can easily become diluted.

These principles should be used as guardrails.

## Principle 1 — Reading Comes First

The social layer must enhance reading, not constantly interrupt it.

## Principle 2 — The Book Is the Interface

Whenever possible, interaction happens **inside the reading journey**, not in disconnected social feeds.

## Principle 3 — Discovery Is Better Than Notification Spam

Finding something a friend left for you should feel rewarding.

## Principle 4 — Protect the Reader From Spoilers

Spoiler protection is a core system behavior, not an optional afterthought.

## Principle 5 — Progress Should Feel Alive

Users should feel themselves and their friends moving through the book.

## Principle 6 — Competition Is Optional

Different readers are motivated in different ways.

## Principle 7 — The Experience Can Become a Memory

Finishing a book should preserve the shared journey instead of ending it.

## Principle 8 — Small Groups First

The strongest initial use case may be two friends or a small private group rather than a massive community.

## Principle 9 — Do Not Become Generic Social Media

Feeds, follower counts, engagement farming, and public popularity should never automatically become the center of the product.

## Principle 10 — Validate the Magic Before Building the Platform

The first question is not:

> “Can we build all of this?”

It is:

> **“When two people actually use this to read a book together, does it feel special?”**

---

# 27. First Success Test

The earliest prototype succeeds if two or more real users can:

1. Add a book.
2. Join the same private room.
3. Read independently.
4. See one another's progress.
5. Leave location-based notes.
6. See that future notes exist without having them spoiled.
7. Reach and reveal those notes naturally.
8. Reply without losing their place in the book.
9. Feel motivated to continue reading partly because of the shared experience.

If that interaction feels genuinely enjoyable, we have evidence that the broader product is worth developing.

---

# 28. Long-Term Possibility

If the core experience proves compelling, this could evolve from a simple website into a broader reading platform with:

- Web reader
- Mobile apps
- Native EPUB library
- Book clubs
- Study groups
- Private reading circles
- Public communities
- Licensed books
- Publisher integrations
- Rich social reading tools
- Cross-device synchronization
- Completed-book memory/journey systems

But none of those are assumptions yet.

They are earned by validating the core shared-reading experience first.

---

# 29. One-Sentence Definition

> **A multiplayer reading experience where friends move through the same book at their own pace, leave reactions and media inside the text, and discover each other's thoughts only when they reach the same moments.**

---

# 30. Core Emotional Promise

The most important thing to preserve as this project evolves:

> **Reading alone should somehow feel like reading together.**

That is the seed.

