// GoTrue look-alike: email + password auth, refresh tokens, password recovery
// and email confirmation links — the parts of Supabase Auth this app uses.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Claims, EmuDb } from "./db";
import { checkPassword, hashPassword, randomToken, readJson, sendJson, signJwt, verifyJwt } from "./util";

const ACCESS_TOKEN_TTL = Number(process.env.EMU_JWT_TTL ?? 3600);

export interface Mail {
  to: string;
  type: "signup" | "recovery";
  link: string;
  created_at: string;
}

export interface AuthOptions {
  siteUrl: string;
  /** When true, sign-up requires clicking the emailed confirmation link (as hosted Supabase does by default). */
  confirmEmail: boolean;
  inbox: Mail[];
  log: (message: string) => void;
}

interface UserRow {
  id: string;
  aud: string;
  role: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: string | null;
  raw_app_meta_data: Record<string, unknown>;
  raw_user_meta_data: Record<string, unknown>;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string;
}

const USER_COLUMNS = `id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, last_sign_in_at, created_at, updated_at`;

function publicUser(row: UserRow) {
  return {
    id: row.id,
    aud: row.aud,
    role: row.role,
    email: row.email,
    email_confirmed_at: row.email_confirmed_at,
    confirmed_at: row.email_confirmed_at,
    phone: "",
    last_sign_in_at: row.last_sign_in_at,
    app_metadata: row.raw_app_meta_data,
    user_metadata: row.raw_user_meta_data,
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_anonymous: false,
  };
}

function authError(res: ServerResponse, status: number, errorCode: string, msg: string) {
  sendJson(res, status, { code: status, error_code: errorCode, msg });
}

export function claimsFromRequest(req: IncomingMessage): Claims | null {
  const header = String(req.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const payload = verifyJwt(token);
  if (!payload || payload.role !== "authenticated" || typeof payload.sub !== "string") return null;
  return payload as Claims;
}

export function claimsFromToken(token: string | undefined | null): Claims | null {
  if (!token) return null;
  const payload = verifyJwt(token);
  if (!payload || payload.role !== "authenticated" || typeof payload.sub !== "string") return null;
  return payload as Claims;
}

async function issueSession(db: EmuDb, user: UserRow, sessionId: string = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const refreshToken = randomToken(18);
  await db.pg.query("insert into auth.refresh_tokens (token, user_id, session_id) values ($1, $2, $3)", [
    refreshToken,
    user.id,
    sessionId,
  ]);
  const accessToken = signJwt({
    iss: "local-emulator/auth/v1",
    sub: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    phone: "",
    app_metadata: user.raw_app_meta_data,
    user_metadata: user.raw_user_meta_data,
    aal: "aal1",
    amr: [{ method: "password", timestamp: now }],
    session_id: sessionId,
    is_anonymous: false,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  });
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL,
    expires_at: now + ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

async function findUserByEmail(db: EmuDb, email: string): Promise<UserRow | null> {
  const res = await db.pg.query<UserRow>(`select ${USER_COLUMNS} from auth.users where email = $1`, [email.toLowerCase()]);
  return res.rows[0] ?? null;
}

async function findUserById(db: EmuDb, id: string): Promise<UserRow | null> {
  const res = await db.pg.query<UserRow>(`select ${USER_COLUMNS} from auth.users where id = $1`, [id]);
  return res.rows[0] ?? null;
}

async function mail(db: EmuDb, options: AuthOptions, user: UserRow, type: Mail["type"], next: string) {
  const tokenHash = randomToken(24);
  await db.pg.query("insert into auth.one_time_tokens (token_hash, user_id, type) values ($1, $2, $3)", [tokenHash, user.id, type]);
  // Mirrors the email templates documented in SETUP.md:
  //   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…&next=…
  const otpType = type === "signup" ? "email" : "recovery";
  const link = `${options.siteUrl}/auth/confirm?token_hash=${tokenHash}&type=${otpType}&next=${encodeURIComponent(next)}`;
  options.inbox.unshift({ to: user.email, type, link, created_at: new Date().toISOString() });
  if (options.inbox.length > 50) options.inbox.length = 50;
  options.log(`✉  ${type} email for ${user.email}: ${link}`);
}

export async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  db: EmuDb,
  options: AuthOptions,
): Promise<void> {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  const method = req.method ?? "GET";

  if (path === "/settings" && method === "GET") {
    sendJson(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: !options.confirmEmail });
    return;
  }

  if (path === "/signup" && method === "POST") {
    const body = ((await readJson(req)) ?? {}) as { email?: string; password?: string; data?: Record<string, unknown> };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return authError(res, 400, "validation_failed", "Unable to validate email address: invalid format");
    }
    if (password.length < 6) {
      return authError(res, 422, "weak_password", "Password should be at least 6 characters.");
    }
    if (await findUserByEmail(db, email)) {
      return authError(res, 422, "user_already_exists", "User already registered");
    }
    let user: UserRow;
    try {
      const inserted = await db.pg.query<UserRow>(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
         values ($1, $2, $3::text::jsonb, $4::text::timestamptz) returning ${USER_COLUMNS}`,
        [email, hashPassword(password), JSON.stringify(body.data ?? {}), options.confirmEmail ? null : new Date().toISOString()],
      );
      user = inserted.rows[0];
    } catch (error) {
      options.log(`signup failed: ${(error as Error).message}`);
      return authError(res, 500, "unexpected_failure", "Database error saving new user");
    }
    if (options.confirmEmail) {
      await mail(db, options, user, "signup", "/home");
      sendJson(res, 200, { ...publicUser(user), confirmation_sent_at: new Date().toISOString() });
      return;
    }
    sendJson(res, 200, await issueSession(db, user));
    return;
  }

  if (path === "/token" && method === "POST") {
    const grant = url.searchParams.get("grant_type");
    const body = ((await readJson(req)) ?? {}) as Record<string, string>;

    if (grant === "password") {
      const user = await findUserByEmail(db, String(body.email ?? ""));
      if (!user || !checkPassword(String(body.password ?? ""), user.encrypted_password)) {
        return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      }
      if (!user.email_confirmed_at) {
        return authError(res, 400, "email_not_confirmed", "Email not confirmed");
      }
      await db.pg.query("update auth.users set last_sign_in_at = now() where id = $1", [user.id]);
      sendJson(res, 200, await issueSession(db, user));
      return;
    }

    if (grant === "refresh_token") {
      const found = await db.pg.query<{ user_id: string; session_id: string; revoked: boolean }>(
        "select user_id, session_id, revoked from auth.refresh_tokens where token = $1",
        [String(body.refresh_token ?? "")],
      );
      const row = found.rows[0];
      if (!row || row.revoked) {
        return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      }
      const user = await findUserById(db, row.user_id);
      if (!user) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      await db.pg.query("update auth.refresh_tokens set revoked = true where token = $1", [body.refresh_token]);
      sendJson(res, 200, await issueSession(db, user, row.session_id));
      return;
    }

    return authError(res, 400, "unsupported_grant_type", `unsupported grant_type ${grant}`);
  }

  if (path === "/verify" && method === "POST") {
    const body = ((await readJson(req)) ?? {}) as { token_hash?: string; type?: string };
    const found = await db.pg.query<{ user_id: string; type: string; fresh: boolean }>(
      "delete from auth.one_time_tokens where token_hash = $1 returning user_id, type, created_at > now() - interval '1 hour' as fresh",
      [String(body.token_hash ?? "")],
    );
    const row = found.rows[0];
    if (!row || !row.fresh) {
      return authError(res, 403, "otp_expired", "Email link is invalid or has expired");
    }
    await db.pg.query("update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), last_sign_in_at = now() where id = $1", [row.user_id]);
    const user = await findUserById(db, row.user_id);
    sendJson(res, 200, await issueSession(db, user!));
    return;
  }

  if (path === "/recover" && method === "POST") {
    const body = ((await readJson(req)) ?? {}) as { email?: string };
    const user = await findUserByEmail(db, String(body.email ?? ""));
    // Like GoTrue: never reveal whether the address exists.
    if (user) await mail(db, options, user, "recovery", "/reset-password");
    sendJson(res, 200, {});
    return;
  }

  if (path === "/resend" && method === "POST") {
    const body = ((await readJson(req)) ?? {}) as { email?: string };
    const user = await findUserByEmail(db, String(body.email ?? ""));
    if (user && !user.email_confirmed_at) await mail(db, options, user, "signup", "/home");
    sendJson(res, 200, {});
    return;
  }

  const claims = claimsFromRequest(req);

  if (path === "/user") {
    if (!claims) return authError(res, 401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    const user = await findUserById(db, claims.sub);
    if (!user) return authError(res, 403, "user_not_found", "User from sub claim in JWT does not exist");

    if (method === "GET") {
      sendJson(res, 200, publicUser(user));
      return;
    }
    if (method === "PUT") {
      const body = ((await readJson(req)) ?? {}) as { password?: string; data?: Record<string, unknown> };
      if (body.password !== undefined) {
        if (String(body.password).length < 6) {
          return authError(res, 422, "weak_password", "Password should be at least 6 characters.");
        }
        await db.pg.query("update auth.users set encrypted_password = $1, updated_at = now() where id = $2", [
          hashPassword(String(body.password)),
          user.id,
        ]);
      }
      if (body.data) {
        await db.pg.query(
          "update auth.users set raw_user_meta_data = raw_user_meta_data || $1::text::jsonb, updated_at = now() where id = $2",
          [JSON.stringify(body.data), user.id],
        );
      }
      sendJson(res, 200, publicUser((await findUserById(db, user.id))!));
      return;
    }
  }

  if (path === "/logout" && method === "POST") {
    if (claims) {
      const scope = url.searchParams.get("scope") ?? "global";
      if (scope === "global") {
        await db.pg.query("update auth.refresh_tokens set revoked = true where user_id = $1", [claims.sub]);
      } else {
        await db.pg.query("update auth.refresh_tokens set revoked = true where session_id = $1::text::uuid", [String(claims.session_id)]);
      }
    }
    res.writeHead(204).end();
    return;
  }

  authError(res, 404, "not_found", `auth route not emulated: ${method} ${path}`);
}
