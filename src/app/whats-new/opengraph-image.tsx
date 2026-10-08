import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/config";
import { LATEST_RELEASE } from "@/lib/whats-new";

// The preview card a chat app shows when someone shares the What's new link.
export const alt = `What's new in ${APP_NAME}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const features = LATEST_RELEASE.items.slice(0, 3);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#faf6ee",
          color: "#2a2520",
          padding: "72px 80px",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 34 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: "#a96542", marginRight: 14 }} />
          {APP_NAME}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#a96542" }}>What&apos;s new</div>
          <div style={{ fontSize: 84, lineHeight: 1.05, marginTop: 18 }}>{LATEST_RELEASE.title}</div>
          <div style={{ fontSize: 34, lineHeight: 1.35, marginTop: 24, color: "#6b6258" }}>{LATEST_RELEASE.summary}</div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#6b6258" }}>{features.map((item) => item.title).join("  ·  ")}</div>
      </div>
    ),
    size,
  );
}
