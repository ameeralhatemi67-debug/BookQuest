"use client";

import { Camera, LogOut, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";
import { friendlyError } from "@/lib/errors";
import { formatLimit, AVATAR_RULE, validateAvatar } from "@/lib/limits";
import { startUpload } from "@/lib/storage/upload";
import { signOutAndClean } from "@/lib/auth-client";
import { getSupabase } from "@/lib/supabase/client";

/** Square-crops and downsizes a picture so avatars stay small and quick to load. */
async function toAvatar(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(320, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.88));
  } catch {
    return null;
  }
}

export function ProfileView({ userId, email, initialName, initialAvatar }: { userId: string; email: string | null; initialName: string; initialAvatar: string | null }) {
  const router = useRouter();
  const supabase = getSupabase();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setBusy("name");
    setError(null);
    const { error: updateError } = await supabase.from("profiles").update({ display_name: name.trim() }).eq("id", userId);
    setBusy(null);
    if (updateError) return setError(friendlyError(updateError));
    toast.success("Name updated.");
    router.refresh();
  }

  async function changeAvatar(file: File | undefined) {
    if (!file) return;
    setError(null);
    const check = validateAvatar(file);
    if (!check.ok) return setError(check.error);
    setBusy("avatar");
    const picture = await toAvatar(file);
    if (!picture) {
      setBusy(null);
      return setError("That image couldn't be read. Try a JPEG or PNG.");
    }
    const path = `${userId}/avatar-${Date.now()}.jpg`;
    try {
      await startUpload({ client: supabase, bucket: "avatars", path, file: picture, contentType: "image/jpeg" }).done;
      const { error: updateError } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", userId);
      if (updateError) throw updateError;
      if (avatar) void supabase.storage.from("avatars").remove([avatar]);
      setAvatar(path);
      toast.success("Picture updated.");
      router.refresh();
    } catch (uploadError) {
      setError(friendlyError(uploadError, "Couldn't upload that picture."));
    } finally {
      setBusy(null);
    }
  }

  async function removeAvatar() {
    if (!avatar) return;
    setBusy("avatar");
    const { error: updateError } = await supabase.from("profiles").update({ avatar_path: null }).eq("id", userId);
    if (!updateError) {
      void supabase.storage.from("avatars").remove([avatar]);
      setAvatar(null);
      router.refresh();
    } else setError(friendlyError(updateError));
    setBusy(null);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (password.length < 8) return setPasswordError("Choose a password with at least 8 characters.");
    setBusy("password");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(null);
    if (updateError) return setPasswordError(friendlyError(updateError));
    setPassword("");
    toast.success("Password changed.");
  }

  async function signOut(scope: "local" | "global") {
    setBusy(scope);
    await signOutAndClean(scope);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-4xl text-ink">Profile</h1>
        <p className="mt-2 text-ink-soft">How the people you read with see you.</p>
      </div>

      <Card className="space-y-6 p-6">
        <FormError>{error}</FormError>
        <div className="flex items-center gap-5">
          <Avatar person={{ id: userId, display_name: name || initialName, avatar_path: avatar }} size={84} />
          <div className="space-y-2">
            <input ref={fileInput} type="file" accept={Object.values(AVATAR_RULE.types).filter((v, i, a) => a.indexOf(v) === i).join(",")} className="sr-only" aria-label="Choose a profile picture" onChange={(event) => {
              void changeAvatar(event.target.files?.[0]);
              event.target.value = "";
            }} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" loading={busy === "avatar"} onClick={() => fileInput.current?.click()} icon={<Camera className="size-4" aria-hidden />}>
                {avatar ? "Change picture" : "Add a picture"}
              </Button>
              {avatar && (
                <Button variant="ghost" size="sm" disabled={busy === "avatar"} onClick={removeAvatar} icon={<Trash2 className="size-4" aria-hidden />}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-ink-faint">JPEG, PNG, WebP or GIF, up to {formatLimit(AVATAR_RULE.maxBytes)}.</p>
          </div>
        </div>

        <form onSubmit={saveName} className="space-y-4">
          <Field label="Display name">{(props) => <Input {...props} value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />}</Field>
          {email && (
            <Field label="Email" hint="Only you and the alpha admin can see this.">
              {(props) => <Input {...props} value={email} readOnly disabled />}
            </Field>
          )}
          <div className="flex justify-end">
            <Button type="submit" loading={busy === "name"} disabled={!name.trim() || name.trim() === initialName}>
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="font-display text-xl text-ink">Password</h2>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <FormError>{passwordError}</FormError>
          <Field label="New password" hint="At least 8 characters.">
            {(props) => <Input {...props} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={busy === "password"} disabled={!password}>
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-6">
        <div>
          <h2 className="font-display text-xl text-ink">Sign out</h2>
          <p className="text-sm text-ink-soft">Your place in every book is saved.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === "local"} onClick={() => signOut("local")} icon={<LogOut className="size-4" aria-hidden />}>
            Sign out
          </Button>
          <Button variant="ghost" loading={busy === "global"} onClick={() => signOut("global")}>
            Sign out everywhere
          </Button>
        </div>
      </Card>
    </div>
  );
}
