import { CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Authentication callback" };

export default function AuthCallbackPage() {
  return (
    <div className="page-shell grid min-h-[calc(100vh-13rem)] place-items-center">
      <Card variant="raised" className="w-full max-w-lg text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--surface-subtle)] text-[var(--muted)]">
          <CircleDashed aria-hidden="true" className="size-5" />
        </span>
        <div className="mt-5">
          <StatusBadge status="not-configured">Not connected</StatusBadge>
        </div>
        <h1 className="font-display mt-5 text-3xl tracking-[-0.04em]">
          Callback route reserved.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Supabase confirmation and session exchange will be implemented in
          Phase 2. This page does not inspect or persist URL parameters.
        </p>
        <Button asChild variant="secondary" className="mt-7">
          <Link href="/auth/sign-in">Return to sign in</Link>
        </Button>
      </Card>
    </div>
  );
}
