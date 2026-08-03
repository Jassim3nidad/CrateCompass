import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/lib/env";
import { getPublicSupabaseEnvironment } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export function createAdminClient() {
  const environment = getServerEnvironment();
  const { url } = getPublicSupabaseEnvironment();

  if (!environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase administrative access is not configured.");
  }

  return createSupabaseClient<Database>(
    url,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
