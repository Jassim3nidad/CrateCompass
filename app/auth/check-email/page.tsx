import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="page-shell grid min-h-[calc(100vh-13rem)] place-items-center">
      <Card variant="raised" className="w-full max-w-lg text-center">
        <MailCheck
          aria-hidden="true"
          className="mx-auto size-10 text-[var(--success-soft)]"
        />
        <h1 className="font-display mt-5 text-3xl tracking-[-0.04em]">
          Check your inbox.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          We sent a confirmation link{email ? ` to ${email}` : ""}. Open it on
          this device to finish creating your account.
        </p>
        <Button asChild variant="secondary" className="mt-7">
          <Link href="/auth/sign-in">Return to sign in</Link>
        </Button>
      </Card>
    </div>
  );
}
