import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProviderStatus } from "@/components/ui/provider-status";
import { MoodForm } from "@/features/foundation/components/mood-form";

export const metadata: Metadata = { title: "Mood" };

export default function MoodPage() {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Mood compass"
        title="Describe the room, not a dropdown."
        description="Write the atmosphere in your own language. The future workflow will make its interpretation visible before finding any music."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Your listening brief</CardTitle>
            <CardDescription>
              Nothing is sent to AI in this foundation phase. The form
              demonstrates limits, focus, disabled, and notification states.
            </CardDescription>
          </CardHeader>
          <MoodForm />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Interpretation pipeline</CardTitle>
            <CardDescription>
              Every step remains visible and recoverable.
            </CardDescription>
          </CardHeader>
          <div className="space-y-3">
            <ProviderStatus
              name="Mood parser"
              status="not-configured"
              description="Structured AI adapter planned for Phase 5."
            />
            <ProviderStatus
              name="Discovery source"
              status="not-configured"
              description="Provider decision is gated before Phase 4."
            />
            <ProviderStatus
              name="Spotify export"
              status="not-configured"
              description="Optional connection arrives in Phase 3."
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
