"use client";

import { Check, Coffee, Flag, Globe2, Heart, Link2, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/format";
import { MAX_ROOM_SIZE, ROOM_MODE_LIST, roomMode, VISIBILITY_INFO } from "@/lib/room-modes";
import type { RoomModeId, RoomVisibility } from "@/lib/types";

export interface RoomSettings {
  name: string;
  description: string;
  mode: RoomModeId;
  visibility: RoomVisibility;
  /** "" = no limit */
  memberLimit: string;
}

const MODE_ICON: Record<RoomModeId, ReactNode> = {
  chill: <Coffee className="size-5" aria-hidden />,
  race: <Flag className="size-5" aria-hidden />,
  duo: <Heart className="size-5" aria-hidden />,
};

export const VISIBILITY_ICON: Record<RoomVisibility, ReactNode> = {
  private: <Lock className="size-4" aria-hidden />,
  unlisted: <Link2 className="size-4" aria-hidden />,
  open: <Globe2 className="size-4" aria-hidden />,
};

export function Choice({ checked, onSelect, disabled, children, className }: { checked: boolean; onSelect: () => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "relative rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "border-accent bg-accent-soft/60" : "border-line-strong bg-raised hover:border-ink-faint",
        className,
      )}
    >
      {checked && (
        <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent">
          <Check className="size-3" aria-hidden />
        </span>
      )}
      {children}
    </button>
  );
}

/** Shared by "New room" and room settings, so both always offer the same, real choices. */
export function RoomSettingsFields({
  value,
  onChange,
  memberCount = 1,
  showIdentity = true,
  showVisibility = true,
}: {
  value: RoomSettings;
  onChange: (next: RoomSettings) => void;
  /** Current number of members (settings): options that would not fit them are disabled. */
  memberCount?: number;
  showIdentity?: boolean;
  /** Room settings change who can join with their own, immediate control instead. */
  showVisibility?: boolean;
}) {
  const mode = roomMode(value.mode);
  const set = (patch: Partial<RoomSettings>) => onChange({ ...value, ...patch });

  const pickMode = (id: RoomModeId) => {
    const next = roomMode(id);
    set({
      mode: id,
      // A Duo is always private and exactly two; leaving Duo lifts the cap.
      visibility: next.visibility.includes(value.visibility) ? value.visibility : next.visibility[0],
      memberLimit: next.fixedSize ? String(next.fixedSize) : value.mode === "duo" ? "" : value.memberLimit,
    });
  };

  return (
    <div className="space-y-7">
      {showIdentity && (
        <>
          <Field label="Room name">
            {(props) => <Input {...props} value={value.name} maxLength={80} required placeholder="e.g. Dune, slowly" onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <Field label="Description" hint="Optional. A line about the pace or the plan.">
            {(props) => <Textarea {...props} value={value.description} maxLength={500} rows={2} onChange={(e) => set({ description: e.target.value })} />}
          </Field>
        </>
      )}

      <fieldset>
        <legend className="text-sm font-medium text-ink">How do you want to read?</legend>
        <div role="radiogroup" aria-label="Room mode" className="mt-2 grid gap-3 sm:grid-cols-3">
          {ROOM_MODE_LIST.map((option) => {
            const tooMany = option.fixedSize !== undefined && memberCount > option.fixedSize;
            return (
              <Choice key={option.id} checked={value.mode === option.id} disabled={tooMany} onSelect={() => pickMode(option.id)}>
                <span className="text-accent-ink">{MODE_ICON[option.id]}</span>
                <span className="mt-2 block font-display text-lg leading-tight text-ink">{option.name}</span>
                <span className="mt-1 block text-sm leading-snug text-ink-soft">{tooMany ? `Needs ${option.fixedSize} readers or fewer.` : option.tagline}</span>
              </Choice>
            );
          })}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{mode.description}</p>
      </fieldset>

      {showVisibility && (
      <fieldset>
        <legend className="text-sm font-medium text-ink">Who can join?</legend>
        <div role="radiogroup" aria-label="Room visibility" className="mt-2 grid gap-2">
          {(["private", "unlisted", "open"] as RoomVisibility[]).map((visibility) => {
            const allowed = mode.visibility.includes(visibility);
            return (
              <Choice key={visibility} checked={value.visibility === visibility} disabled={!allowed} onSelect={() => set({ visibility })} className="py-3">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <span className="text-ink-faint">{VISIBILITY_ICON[visibility]}</span>
                  {VISIBILITY_INFO[visibility].name}
                </span>
                <span className="mt-0.5 block pr-6 text-sm leading-snug text-ink-soft">
                  {allowed ? VISIBILITY_INFO[visibility].description : `Not available for a ${mode.name}.`}
                </span>
              </Choice>
            );
          })}
        </div>
      </fieldset>
      )}

      {!mode.fixedSize && (
        <Field label="Member limit" hint={`Optional. Leave empty for up to ${MAX_ROOM_SIZE} readers. Small groups tend to feel best.`}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={Math.max(2, memberCount)}
              max={MAX_ROOM_SIZE}
              className="max-w-32"
              value={value.memberLimit}
              placeholder="No limit"
              onChange={(e) => set({ memberLimit: e.target.value })}
            />
          )}
        </Field>
      )}
    </div>
  );
}

export function parseMemberLimit(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}
