import { Compass } from "lucide-react";
import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { AuthForm } from "@/features/auth/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <div className="page-shell grid min-h-[calc(100vh-13rem)] place-items-center">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--amber-soft)]">
            <Compass aria-hidden="true" className="size-5" />
          </span>
          <h1 className="font-display mt-5 text-4xl tracking-[-0.04em]">
            Welcome back.
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Return to your discoveries, notes, and listening trails.
          </p>
        </div>
        <Card variant="raised">
          <AuthForm mode="sign-in" returnTo={returnTo} />
        </Card>
      </div>
    </div>
  );
}
