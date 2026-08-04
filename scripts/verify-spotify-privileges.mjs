/**
 * Live privilege check for the Phase 3 Spotify RPCs.
 *
 * The pgTAP suite in supabase/tests asserts the same properties, but
 * `supabase test db` requires Docker. This script verifies the property that
 * actually matters — that a browser-facing anonymous caller cannot reach
 * stored Spotify credentials — end to end through PostgREST, using only the
 * publishable key a browser would have.
 *
 * Usage: node scripts/verify-spotify-privileges.mjs
 */

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.error("Supabase is not configured; cannot verify privileges.");
  process.exit(1);
}

const anonymous = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const syntheticUuid = "00000000-0000-4000-8000-000000000000";
const syntheticBytea = "\\xdeadbeef";

const rpcChecks = [
  ["read_spotify_credentials", { p_user_id: syntheticUuid }],
  ["consume_spotify_oauth", { p_state_digest: syntheticBytea }],
  ["disconnect_spotify", { p_user_id: syntheticUuid }],
  ["mark_spotify_connection_expired", { p_user_id: syntheticUuid }],
  ["purge_expired_spotify_oauth_transactions", {}],
  [
    "claim_spotify_connection",
    {
      p_connection_id: syntheticUuid,
      p_user_id: syntheticUuid,
      p_spotify_user_id: "synthetic",
      p_display_name: "synthetic",
      p_scopes: ["playlist-modify-private"],
    },
  ],
];

const results = [];

for (const [name, args] of rpcChecks) {
  const { data, error } = await anonymous.rpc(name, args);
  const denied = Boolean(error) && data === null;

  results.push({
    check: `anon cannot execute ${name}`,
    passed: denied,
    detail: error ? `${error.code ?? "?"}: ${error.message}` : "CALL SUCCEEDED",
  });
}

// Connection metadata is selectable by its owner under RLS, so an anonymous
// caller must simply see nothing rather than receive an error.
const connectionRead = await anonymous
  .from("spotify_connections")
  .select("spotify_user_id");

results.push({
  check: "anon reads no connection rows",
  passed: !connectionRead.data || connectionRead.data.length === 0,
  detail: `rows=${connectionRead.data?.length ?? 0}`,
});

const connectionWrite = await anonymous
  .from("spotify_connections")
  .insert({ user_id: syntheticUuid, spotify_user_id: "synthetic" });

results.push({
  check: "anon cannot insert a connection",
  passed: Boolean(connectionWrite.error),
  detail: connectionWrite.error
    ? `${connectionWrite.error.code}: ${connectionWrite.error.message}`
    : "INSERT SUCCEEDED",
});

let failed = 0;

for (const result of results) {
  if (!result.passed) failed += 1;
  console.log(
    `${result.passed ? "PASS" : "FAIL"}  ${result.check}  (${result.detail})`,
  );
}

console.log(
  `\n${results.length - failed}/${results.length} privilege checks passed.`,
);

process.exit(failed === 0 ? 0 : 1);
