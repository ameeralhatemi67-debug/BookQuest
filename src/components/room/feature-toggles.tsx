"use client";

import { useState } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { FEATURES, featureOn, type FeatureKey } from "@/lib/features";
import { cn } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import type { RoomFeatures } from "@/lib/types";

/** A real switch: role, state and a 44px target, drawn as a small paper toggle. */
export function Switch({ checked, onChange, disabled, label, describedBy }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string; describedBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group/switch -m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full p-2 disabled:opacity-50"
    >
      <span className={cn("relative h-6 w-10 rounded-full transition-colors duration-200", checked ? "bg-accent" : "bg-line-strong")}>
        <span
          className={cn(
            "absolute left-0.5 top-0.5 size-5 rounded-full bg-raised shadow-soft transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-active/switch:scale-90",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

/**
 * Per-room experiment switches. Changes save one at a time so a tester never
 * loses a half-edited form, and the panel shows the saved state.
 */
export function FeatureToggles({ roomId, features, onSaved, disabled, compact }: { roomId: string; features: RoomFeatures | undefined; onSaved?: (next: RoomFeatures) => void; disabled?: boolean; compact?: boolean }) {
  const [current, setCurrent] = useState<RoomFeatures>(features ?? {});
  const [saving, setSaving] = useState<FeatureKey | null>(null);

  async function toggle(key: FeatureKey, next: boolean) {
    setSaving(key);
    const previous = current;
    setCurrent({ ...current, [key]: next });
    const { data, error } = await getSupabase().rpc("set_room_features", { p_room_id: roomId, p_features: { [key]: next } });
    setSaving(null);
    if (error) {
      setCurrent(previous);
      return void toast.error(friendlyError(error));
    }
    setCurrent(data as RoomFeatures);
    onSaved?.(data as RoomFeatures);
  }

  const groups = [...new Set(FEATURES.map((f) => f.group))];
  return (
    <div className={cn("grid gap-x-8 gap-y-5", !compact && "sm:grid-cols-2")}>
      {groups.map((group) => (
        <fieldset key={group} className="min-w-0">
          <legend className="mb-1 text-sm font-medium text-ink">{group}</legend>
          <ul className="divide-y divide-line">
            {FEATURES.filter((f) => f.group === group).map((feature) => (
              <li key={feature.key} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{feature.name}</p>
                  <p id={`feature-${roomId}-${feature.key}`} className="text-xs leading-snug text-ink-faint">{feature.description}</p>
                </div>
                <Switch
                  label={feature.name}
                  describedBy={`feature-${roomId}-${feature.key}`}
                  checked={featureOn(current, feature.key)}
                  disabled={disabled || saving === feature.key}
                  onChange={(next) => void toggle(feature.key, next)}
                />
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
