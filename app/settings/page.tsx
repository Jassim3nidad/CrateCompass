import { ArrowRight, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProviderStatus } from "@/components/ui/provider-status";
import {
  DeleteAccountForm,
  ProfileForm,
} from "@/features/auth/components/account-forms";
import {
  readProviderReadiness,
  type SpotifyConnectionState,
} from "@/lib/providers/readiness";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ password?: string }>;
}) {
  const { password } = await searchParams;
  const { supabase, user } = await getAuthenticatedUser();
  const [{ data: profile }, { data: spotifyConnection }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, preferred_ai_provider")
      .single(),
    supabase.from("spotify_connections").select("status").maybeSingle(),
  ]);

  const connectionState: SpotifyConnectionState = !spotifyConnection
    ? "none"
    : spotifyConnection.status === "active"
      ? "active"
      : "needs-attention";
  const providers = readProviderReadiness(connectionState);

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Settings"
        title="Connections without lock-in."
        description={`Signed in as ${user.email ?? "your CrateCompass account"}. Your identity stays independent from optional providers.`}
      />
      {password === "updated" ? (
        <p role="status" className="mb-6 text-sm text-[var(--success-soft)]">
          Your password has been updated.
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card variant="raised">
          <CardHeader>
            <UserRound
              aria-hidden="true"
              className="size-6 text-[var(--amber-soft)]"
            />
            <CardTitle className="pt-4">Profile</CardTitle>
            <CardDescription>
              Stored in your RLS-protected profile row.
            </CardDescription>
          </CardHeader>
          <ProfileForm
            displayName={profile?.display_name ?? "Listener"}
            preferredAiProvider={profile?.preferred_ai_provider ?? "openai"}
          />
        </Card>

        <Card variant="raised">
          <CardHeader>
            <CardTitle>Provider readiness</CardTitle>
            <CardDescription>
              Credentials remain server-only and optional.
            </CardDescription>
          </CardHeader>
          <div className="space-y-3">
            <ProviderStatus
              name="Supabase"
              status="available"
              description="Authentication, sessions, profiles, and RLS are active — you are reading this through them."
            />
            {providers.map((provider) => (
              <ProviderStatus
                key={provider.name}
                name={provider.name}
                status={provider.status}
                description={provider.description}
              />
            ))}
            <Link
              href="/settings/connections"
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full text-sm font-semibold text-[var(--accent-foreground)] underline underline-offset-4 transition-colors duration-[var(--duration-fast)] hover:text-[var(--foreground)] motion-reduce:transition-none"
            >
              Manage Spotify connection
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <ShieldCheck
              aria-hidden="true"
              className="size-6 text-[var(--danger-soft)]"
            />
            <CardTitle className="pt-4">Delete account</CardTitle>
            <CardDescription>
              This permanently deletes the Supabase identity and cascades to all
              CrateCompass-owned rows. Re-enter your password to verify recent
              authentication.
            </CardDescription>
          </CardHeader>
          <DeleteAccountForm />
        </Card>
      </div>
    </div>
  );
}
