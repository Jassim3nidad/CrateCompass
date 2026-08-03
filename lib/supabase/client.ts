"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseEnvironment } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export function createClient() {
  const environment = getPublicSupabaseEnvironment();

  return createBrowserClient<Database>(
    environment.url,
    environment.publishableKey,
  );
}
