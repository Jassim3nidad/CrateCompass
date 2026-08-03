import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { AuthForm } from "@/features/auth/components/auth-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <div className="page-shell grid min-h-[calc(100vh-13rem)] place-items-center">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <ShieldCheck
            aria-hidden="true"
            className="mx-auto size-10 text-[var(--success-soft)]"
          />
          <h1 className="font-display mt-5 text-4xl tracking-[-0.04em]">
            Choose a new password.
          </h1>
        </div>
        <Card variant="raised">
          <AuthForm mode="update-password" />
        </Card>
      </div>
    </div>
  );
}
