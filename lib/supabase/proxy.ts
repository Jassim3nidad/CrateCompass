import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSafeReturnPath } from "@/lib/security/safe-redirect";
import { getPublicSupabaseEnvironment } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

const protectedPrefixes = ["/library", "/history", "/settings"] as const;

function isProtectedPath(pathname: string) {
  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function copyResponseCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const environment = getPublicSupabaseEnvironment();
  const supabase = createServerClient<Database>(
    environment.url,
    environment.publishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);

  if (!isAuthenticated && isProtectedPath(request.nextUrl.pathname)) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/auth/sign-in";
    signInUrl.search = "";
    const requestedPath = getSafeReturnPath(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      "/discover",
    );
    signInUrl.searchParams.set("returnTo", requestedPath);
    return copyResponseCookies(response, NextResponse.redirect(signInUrl));
  }

  return response;
}
