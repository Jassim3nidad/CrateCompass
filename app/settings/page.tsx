import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProviderStatus } from "@/components/ui/provider-status";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Settings"
        title="Connections without lock-in."
        description="Your CrateCompass identity stays independent. External providers remain optional, attributable, and revocable."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Provider readiness</CardTitle>
            <CardDescription>
              Foundation states only; no credentials are loaded by this page.
            </CardDescription>
          </CardHeader>
          <div className="space-y-3">
            <ProviderStatus
              name="Supabase"
              status="not-configured"
              description="Primary authentication and RLS database planned for Phase 2."
            />
            <ProviderStatus
              name="Spotify"
              status="not-configured"
              description="Optional connected account planned for Phase 3."
            />
            <ProviderStatus
              name="MusicBrainz"
              status="not-configured"
              description="Canonical identity and discography planned for Phase 4."
            />
            <ProviderStatus
              name="Discovery and AI"
              status="not-configured"
              description="Provider gates remain intentionally closed."
            />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <ShieldCheck
              aria-hidden="true"
              className="size-6 text-[var(--success-soft)]"
            />
            <CardTitle className="pt-4">Privacy controls</CardTitle>
            <CardDescription>
              Disconnect and deletion actions are visible now but remain
              disabled until their secure workflows exist.
            </CardDescription>
          </CardHeader>
          <div className="space-y-3">
            <Button
              variant="secondary"
              className="w-full justify-start"
              disabled
            >
              Disconnect Spotify
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-start"
              disabled
            >
              Delete CrateCompass account
            </Button>
          </div>
          <p className="mt-5 text-sm leading-6 text-[var(--muted)]">
            Spotify data will never be sent to an AI provider. These controls
            will include confirmation, recent authentication, and clear
            outcomes.
          </p>
        </Card>
      </div>
    </div>
  );
}
