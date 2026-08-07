import "server-only";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything one listener owns, in one call.
 *
 * There is deliberately no route, no server action and no interface reaching
 * this. Phase 9 ships the enumeration, not the download: the requirement is
 * export *documentation*, and the operator-run procedure in
 * `docs/security/data-handling.md` is what that documents. The download, its
 * route and its interface belong to Phase 12 with the privacy-policy draft.
 *
 * The enumeration ships now because it is the half that catches mistakes. It is
 * the definitive list of every table holding user-owned data, which is the same
 * list account deletion must cover, and nothing validated that list before.
 * Phase 9 alone added tags, sessions written for the first time and explanation
 * snapshots — exactly the rows a cascade forgets.
 *
 * Two tests give it its value, both in `supabase/tests/phase_9_library.test.sql`:
 * every public table owned by a user must appear in the output, so a table
 * added later fails until registered; and after account deletion it must return
 * nothing, which is the residual-data check the threat model commits to as T23.
 */

export interface UserDataExport {
  readonly generatedAt: string;
  readonly userId: string;
  readonly tables: Record<string, readonly unknown[]>;
}

/**
 * Reads through `service_role`, which is correct here rather than a shortcut.
 *
 * The function is granted to `service_role` only and is revoked from every
 * browser-facing role: it takes a user id, so EXECUTE from `authenticated`
 * would let a signed-in listener enumerate somebody else's account. There is no
 * table grant involved — `export_user_data` is `security definer`, which is the
 * same pattern `claim_ai_usage` and `read_ai_usage_remaining` follow.
 */
export async function collectUserData(
  userId: string,
): Promise<UserDataExport | null> {
  const { data, error } = await createAdminClient().rpc("export_user_data", {
    p_user_id: userId,
  });

  if (error || data === null || typeof data !== "object") {
    logger.error({ event: "privacy.export_failed", code: error?.code });
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    userId,
    tables: data as Record<string, readonly unknown[]>,
  };
}
