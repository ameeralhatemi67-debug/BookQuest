import type { Metadata } from "next";
import { ProfileView } from "@/components/app/profile-view";
import { requireAlpha } from "@/lib/supabase/guard";
import { createSupabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const me = await requireAlpha();
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  return <ProfileView userId={me.user_id} email={data.user?.email ?? null} initialName={me.display_name} initialAvatar={me.avatar_path} />;
}
