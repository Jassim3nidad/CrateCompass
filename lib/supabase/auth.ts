import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user, or null.
 *
 * Used by pages that work for everyone but personalise for a signed-in user —
 * discovery is browsable anonymously, while saving and dismissing are not.
 * Redirecting an anonymous visitor away from a public page would be wrong, so
 * this deliberately does not redirect.
 */
export async function getOptionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/sign-in");
  }

  return { supabase, user };
}
