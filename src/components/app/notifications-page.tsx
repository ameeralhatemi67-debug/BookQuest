"use client";

import { BellOff } from "lucide-react";
import { NotificationRow, useNotifications } from "@/components/app/notifications";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";

export function NotificationsPage() {
  const { items, unread, loading, markRead } = useNotifications();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl text-ink">Activity</h1>
          <p className="mt-2 text-ink-soft">Replies, reactions and discoveries. Page-turns never show up here.</p>
        </div>
        {unread > 0 && (
          <Button variant="secondary" size="sm" onClick={() => void markRead()}>
            Mark all read
          </Button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<BellOff className="size-5" aria-hidden />} title="Nothing yet">
          When a friend replies, reacts, joins a room or reaches something you left in a book, you&apos;ll see it here.
        </EmptyState>
      ) : (
        <Card className="p-2">
          {items.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </Card>
      )}
    </div>
  );
}
