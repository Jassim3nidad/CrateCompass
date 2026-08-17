import { KeyRound } from "lucide-react";
import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { AuthForm } from "@/features/auth/components/auth-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="page-shell grid min-h-[calc(100vh-13rem)] place-items-center">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="surface-raised elev-flat mx-auto grid size-12 place-items-center rounded-full text-[var(--amber-soft)]">
            <KeyRound aria-hidden="true" className="size-5" />
          </span>
          <h1 className="font-display mt-5 text-4xl tracking-[-0.04em]">
            Reset your password.
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            We’ll send a single-use recovery link if the account exists.
          </p>
        </div>
        <Card variant="raised">
          <AuthForm mode="forgot-password" />
        </Card>
      </div>
    </div>
  );
}
