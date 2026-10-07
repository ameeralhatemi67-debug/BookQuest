"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormNotice, Input } from "@/components/ui/field";
import { siteUrl } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { signOutAndClean } from "@/lib/auth-client";
import { getSupabase } from "@/lib/supabase/client";

const MIN_PASSWORD = 8;

/** Only ever follow a same-site path after signing in. */
function safeNext(next: string | null | undefined, fallback = "/home"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError(friendlyError(signInError, "Couldn't sign you in. Please try again."));
      setBusy(false);
      return;
    }
    router.replace(safeNext(next));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="Email">
        {(props) => (
          <Input {...props} type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </Field>
      <Field label="Password">
        {(props) => (
          <Input {...props} type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-accent-ink underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
        Sign in
      </Button>
      <p className="text-center text-sm text-ink-soft">
        New here?{" "}
        <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-accent-ink underline-offset-4 hover:underline">
          Create your account
        </Link>
      </p>
    </form>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 1) return setError("Tell us what to call you.");
    if (password.length < MIN_PASSWORD) return setError(`Choose a password with at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    const destination = safeNext(next);
    const { data, error: signUpError } = await getSupabase().auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Read by the database trigger that creates the profile and takes a seat in the alpha.
        data: { display_name: name.trim() },
        emailRedirectTo: `${siteUrl()}/auth/confirm?next=${encodeURIComponent(destination)}`,
      },
    });
    if (signUpError) {
      setError(friendlyError(signUpError, "Couldn't create your account. Please try again."));
      setBusy(false);
      return;
    }
    if (data.session) {
      router.replace(destination);
      router.refresh();
      return;
    }
    // Email confirmation is switched on: no session until the link is opened.
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <FormNotice>
          We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your account.
        </FormNotice>
        <p className="text-sm text-ink-soft">
          Nothing arrived? Check spam, or{" "}
          <button type="button" className="font-medium text-accent-ink underline-offset-4 hover:underline" onClick={() => setSent(false)}>
            try a different address
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="Your name" hint="How friends will see you inside a book.">
        {(props) => <Input {...props} name="name" autoComplete="name" maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Email">
        {(props) => (
          <Input {...props} type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </Field>
      <Field label="Password" hint={`At least ${MIN_PASSWORD} characters.`}>
        {(props) => (
          <Input {...props} type="password" name="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password || !name}>
        Create account
      </Button>
      <p className="text-center text-sm text-ink-soft">
        Already have an account?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-accent-ink underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (resetError) return setError(friendlyError(resetError, "Couldn't send the reset email. Please try again."));
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <FormNotice>
          If an account exists for <strong>{email}</strong>, a link to choose a new password is on its way.
        </FormNotice>
        <Link href="/login" className="block text-center text-sm font-medium text-accent-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="Email">
        {(props) => (
          <Input {...props} type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email}>
        Send reset link
      </Button>
      <Link href="/login" className="block text-center text-sm text-ink-soft underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Choose a password with at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const { error: updateError } = await getSupabase().auth.updateUser({ password });
    if (updateError) {
      setError(friendlyError(updateError, "Couldn't update your password. The link may have expired."));
      setBusy(false);
      return;
    }
    router.replace("/home");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>
      <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
        {(props) => <Input {...props} type="password" name="new-password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Field label="Repeat it">
        {(props) => <Input {...props} type="password" name="confirm-password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!password || !confirm}>
        Save new password
      </Button>
    </form>
  );
}

/** For readers who arrived after every seat was taken: takes the next free one. */
export function ClaimSeatButton({ next }: { next?: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function claim() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: claimError } = await getSupabase().rpc("claim_alpha_seat");
    setBusy(false);
    if (claimError) return setError(friendlyError(claimError));
    if ((data as { status: string }).status === "active") {
      router.replace(safeNext(next));
      router.refresh();
      return;
    }
    setNotice("Still full. You'll get the next seat that opens, or the person running the alpha can let you in.");
  }

  return (
    <div className="space-y-4">
      <FormError>{error}</FormError>
      {notice && <FormNotice>{notice}</FormNotice>}
      <Button size="lg" className="w-full" loading={busy} onClick={claim}>
        Check for a free seat
      </Button>
    </div>
  );
}

export function SignOutButton({ className, children = "Sign out" }: { className?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOutAndClean();
        router.replace("/login");
        router.refresh();
      }}
    >
      {children}
    </button>
  );
}
