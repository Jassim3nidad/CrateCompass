import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Authentication error" };

export default function AuthErrorPage() {
  return (
    <div className="page-shell grid min-h-[calc(100vh-13rem)] place-items-center">
      <Card variant="raised" className="w-full max-w-lg text-center">
        <CircleAlert
          aria-hidden="true"
          className="mx-auto size-10 text-[var(--danger-soft)]"
        />
        <h1 className="font-display mt-5 text-3xl tracking-[-0.04em]">
          That link cannot be used.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          It may have expired or already been used. Start again to receive a
          fresh link.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button asChild variant="secondary">
            <Link href="/auth/forgot-password">Reset password</Link>
          </Button>
          <Button asChild variant="accent">
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
