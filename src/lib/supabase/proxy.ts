import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that never require a session.
// /whats-new is what a shared What's new link opens; friends have no account yet.
const PUBLIC_PATHS = ["/", "/login", "/signup", "/forgot-password", "/auth", "/whats-new"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)));
}

/**
 * Refreshes the Supabase session cookie on every request and keeps signed-out
 * visitors away from the app. This is a convenience gate for navigation only:
 * the actual protection of data is RLS in the database.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Not configured yet: let the app render its own "connect Supabase" screen.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it is what
  // validates the token and refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    // Remember where they were going (e.g. an invitation link).
    login.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  if (signedIn && (pathname === "/" || pathname === "/login" || pathname === "/signup")) {
    const next = request.nextUrl.searchParams.get("next");
    const home = request.nextUrl.clone();
    home.search = "";
    home.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next.split("?")[0] : "/home";
    if (next && next.includes("?")) home.search = next.slice(next.indexOf("?"));
    const redirect = NextResponse.redirect(home);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
