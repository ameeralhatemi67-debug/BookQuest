import type { Metadata } from "next";
import { NotificationsPage } from "@/components/app/notifications-page";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return <NotificationsPage />;
}
