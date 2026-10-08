import { describe, expect, it } from "vitest";
import { LATEST_RELEASE, WHATS_NEW, whatsNewShare, WHATS_NEW_PATH } from "@/lib/whats-new";

describe("what's new", () => {
  it("has unique release ids and no empty copy, newest first", () => {
    const ids = WHATS_NEW.map((release) => release.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(WHATS_NEW[0]).toBe(LATEST_RELEASE);
    const dates = WHATS_NEW.map((release) => release.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const release of WHATS_NEW) {
      expect(release.items.length).toBeGreaterThan(0);
      for (const item of release.items) {
        expect(item.title.trim()).not.toBe("");
        expect(item.body.trim()).not.toBe("");
      }
    }
  });

  it("builds a share message that stands on its own and links to the public page", () => {
    const share = whatsNewShare(LATEST_RELEASE, "Marginalia", "https://example.app/");
    expect(share.url).toBe(`https://example.app${WHATS_NEW_PATH}`);
    expect(share.title).toContain("Marginalia");
    expect(share.title).toContain(LATEST_RELEASE.title);
    expect(share.text).toContain(LATEST_RELEASE.summary);
    expect(share.text).toContain(`• ${LATEST_RELEASE.items[0].title}`);
    // The link travels separately, so it is never duplicated inside the text.
    expect(share.text).not.toContain("https://");
  });

  it("lists only a few highlights and says how many more there are", () => {
    const long = { ...LATEST_RELEASE, items: Array.from({ length: 9 }, (_, i) => ({ icon: "book" as const, title: `Feature ${i}`, body: "Body" })) };
    const share = whatsNewShare(long, "Marginalia", "https://example.app");
    expect(share.text.match(/•/g)).toHaveLength(4);
    expect(share.text).toContain("…and 5 more.");
    const short = whatsNewShare({ ...long, items: long.items.slice(0, 2) }, "Marginalia", "https://example.app");
    expect(short.text).not.toContain("more");
  });
});
