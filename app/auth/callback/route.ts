import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getSafeReturnPath } from "@/lib/security/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const allowedOtpTypes: readonly EmailOtpType[] = [
  "email",
  "recovery",
  "signup",
  "email_change",
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const requestedType = searchParams.get("type") as EmailOtpType | null;
  const nextPath = getSafeReturnPath(searchParams.get("next"));
  const supabase = await createClient();

  let error: Error | null = null;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (
    tokenHash &&
    requestedType &&
    allowedOtpTypes.includes(requestedType)
  ) {
    ({ error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: requestedType,
    }));
  } else {
    error = new Error("Missing authentication callback parameters.");
  }

  const destination = request.nextUrl.clone();
  destination.search = "";
  destination.pathname = error ? "/auth/error" : nextPath;
  if (error) destination.searchParams.set("reason", "invalid-or-expired");

  return NextResponse.redirect(destination);
}
