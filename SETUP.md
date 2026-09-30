# BookQuest setup and deployment

The alpha uses Next.js on Vercel and hosted Supabase for Auth, Postgres, private Storage and Realtime. The connected production site is https://book-quest-ecru.vercel.app/.

## Existing hosted project

Supabase project `dciaumziiwdoudjgiexf` has the committed migrations applied. Future schema changes must use new additive migrations; do not rewrite an applied migration or run `supabase/seed.sql` remotely.

Production and Preview on Vercel have these public build variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://dciaumziiwdoudjgiexf.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key |
| `NEXT_PUBLIC_SITE_URL` | `https://book-quest-ecru.vercel.app` |
| `NEXT_PUBLIC_UPLOAD_LIMIT_MB` | `50` |

The application never needs a secret key. Changing a public build variable requires a new deployment. Preview currently uses the same database as production; use a separate backend before testing destructive migrations in previews.

Auth Site URL is the production origin. Allowed redirects include that origin with `/**` and `http://localhost:3000/**`. Minimum password length is eight. Signup email confirmation is **off**, explicitly approved for this invitation-only alpha. Email ownership is therefore not verified for ordinary testers.

Two owner-designated accounts were provisioned and activated as admins. Their one-use password-setup links are private, expire after one hour and are not committed. Set their passwords before sharing the alpha. Admin is at `/admin`; normal users cannot access its RPCs.

The friend invitation code is private, limited to 20 uses and expires 30 days after creation. It is not in the repository. Admin → Access can create/revoke more codes and grant access. Share the code only with your test group; a room invitation grants room membership after alpha access, not alpha access itself.

## Apply future changes

```powershell
npx supabase login
npx supabase link --project-ref dciaumziiwdoudjgiexf
npx supabase db push
npm run test:all
npm run typecheck
npm run lint
npm run build
```

Review the database changes before applying them. Commit and push the production branch to GitHub; Vercel's Git integration can build it. The authenticated CLI fallback is:

```powershell
npx vercel link --project book-quest
npx vercel --prod --yes
npx vercel inspect https://book-quest-ecru.vercel.app
```

Confirm the deployed commit, successful build and live signup/upload/room/reader flow. CLI credentials and `.vercel` are ignored. For multiline CLI input on PowerShell, use a file or stdin instead of interpolating shell code.

## Email and file settings

The HTML templates in `supabase/templates` use `/auth/confirm` with a token hash, allowing recovery on a different browser. Signup confirmation preserves the invitation destination through `RedirectTo`; the app supplies `/auth/confirm?next=…`. `/auth/callback` remains for PKCE code exchange.

Configure your own SMTP provider in Supabase Auth before relying on password-reset delivery to arbitrary tester addresses. Email confirmation is not needed for this alpha's signup. Password changes while signed in are available in Profile. Never claim a reset was delivered without testing the actual mailbox.

Storage's effective global ceiling is 50 MB. The app's public limit matches it; image attachments remain limited to 25 MB and avatars to 10 MB. Raising the global ceiling also requires changing the public build variable and redeploying. Private bucket rules and finalization RPCs enforce their own per-format ceilings.

## New environments

Create a separate Supabase project, link it, apply all migrations and set its public variables in Vercel. Set Auth URLs and email templates for its own origin. Provision the first admin by creating an Auth user, then updating that user's `alpha_testers` row through an owner-controlled SQL session:

```sql
update public.alpha_testers
set status = 'active', is_admin = true,
    access_source = 'owner-provisioned', activated_at = now()
where user_id = '<verified owner account UUID>'::uuid;
```

Reserve privileged accounts before permitting unverified signup. Avoid granting admin solely because an unverified email matches an allowlist. Use the admin interface to issue limited alpha codes. Do not deploy the local emulator or its control endpoints.
