import { KeyRound, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ConnectSpotifyForm,
  DisconnectSpotifyForm,
} from "@/features/spotify/components/connection-actions";
import {
  callbackPresentation,
  connectionPresentation,
} from "@/features/spotify/connection-presentation";
import { isSpotifyCallbackStatus } from "@/features/spotify/state";
import {
  hasRequiredScopes,
  SPOTIFY_SCOPES,
} from "@/lib/providers/spotify/config";
import { isSpotifyConfigured } from "@/lib/providers/spotify/config";
import type { SpotifyConnectionState } from "@/lib/providers/spotify/types";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Connections" };

interface ConnectionRow {
  readonly spotify_user_id: string;
  readonly display_name: string | null;
  readonly scopes: string[];
  readonly status: string;
  readonly connected_at: string;
  readonly last_verified_at: string | null;
}

function resolveState(
  configured: boolean,
  connection: ConnectionRow | null,
): SpotifyConnectionState {
  if (!configured) return "not-configured";
  if (!connection) return "not-connected";
  if (connection.status === "revoked") return "revoked";
  if (connection.status === "expired") return "reauthorization-required";
  if (!hasRequiredScopes(connection.scopes)) return "insufficient-scope";
  return "active";
}

export default async function ConnectionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ spotify?: string }>;
}) {
  const [{ spotify }, { supabase }] = await Promise.all([
    searchParams,
    getAuthenticatedUser(),
  ]);

  // Read through the user's own client: RLS scopes this to their row, so the
  // page needs no service-role access.
  const { data: connection } = await supabase
    .from("spotify_connections")
    .select(
      "spotify_user_id, display_name, scopes, status, connected_at, last_verified_at",
    )
    .maybeSingle();

  const configured = isSpotifyConfigured();
  const state = resolveState(configured, connection);
  const presentation = connectionPresentation[state];
  const callback = isSpotifyCallbackStatus(spotify)
    ? callbackPresentation[spotify]
    : null;

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Connections"
        title="Spotify is optional, and separate."
        description="Your CrateCompass account is its own identity. Connecting Spotify only adds the ability to export playlists you have explicitly approved."
      />

      {callback ? (
        <p
          role={callback.tone === "error" ? "alert" : "status"}
          className={
            callback.tone === "error"
              ? "mb-6 text-sm text-[var(--danger-soft)]"
              : "mb-6 text-sm text-[var(--success-soft)]"
          }
        >
          {callback.message}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card variant="raised">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Spotify</CardTitle>
              <StatusBadge status={presentation.badge}>
                {presentation.label}
              </StatusBadge>
            </div>
            <CardDescription>{presentation.description}</CardDescription>
          </CardHeader>

          <dl className="mb-6 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted)]">Connected account</dt>
              <dd className="text-right">
                {connection
                  ? connection.display_name || connection.spotify_user_id
                  : "None"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted)]">Granted permissions</dt>
              <dd className="text-right">
                {connection && connection.scopes.length > 0
                  ? connection.scopes.join(", ")
                  : `None — ${SPOTIFY_SCOPES.join(", ")} is requested`}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--muted)]">Last verified</dt>
              <dd className="text-right">
                {connection?.last_verified_at
                  ? new Date(connection.last_verified_at).toLocaleDateString()
                  : "Never"}
              </dd>
            </div>
          </dl>

          <div className="space-y-4">
            {presentation.action === "connect" ? (
              <ConnectSpotifyForm
                label="Connect Spotify"
                disabled={!configured}
              />
            ) : null}
            {presentation.action === "reconnect" ? (
              <ConnectSpotifyForm
                label="Reconnect Spotify"
                disabled={!configured}
              />
            ) : null}
            {connection && connection.status !== "revoked" ? (
              <DisconnectSpotifyForm
                secondary={presentation.action === "reconnect"}
              />
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <ShieldCheck
              aria-hidden="true"
              className="size-6 text-[var(--success-soft)]"
            />
            <CardTitle className="pt-4">What this connection does</CardTitle>
            <CardDescription>
              The permissions and storage below are the whole of it.
            </CardDescription>
          </CardHeader>

          <ul className="space-y-3 text-sm text-[var(--muted)]">
            <li>
              CrateCompass requests one permission:{" "}
              <strong className="text-[var(--foreground)]">
                {SPOTIFY_SCOPES.join(", ")}
              </strong>
              . That is enough to create a private playlist and add the tracks
              you approved, and nothing else.
            </li>
            <li>
              It does not request access to your listening history, top artists,
              saved library, playback, or email address.
            </li>
            <li>
              <strong className="text-[var(--foreground)]">
                Spotify data is never sent to an AI provider.
              </strong>{" "}
              Discovery and explanations are built from MusicBrainz and
              independent sources instead.
            </li>
            <li>
              Stored here: your Spotify account identifier, the granted
              permissions, and an encrypted credential. Your Spotify catalogue,
              artwork, and playlist contents are not copied.
            </li>
            <li>
              Disconnecting destroys the stored credential immediately.
              Playlists already created stay in your Spotify account, because
              they are yours.
            </li>
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <KeyRound
              aria-hidden="true"
              className="size-6 text-[var(--amber-soft)]"
            />
            <CardTitle className="pt-4">How credentials are held</CardTitle>
            <CardDescription>
              Credentials never reach the browser. They are encrypted with
              AES-256-GCM, bound to your account so a stored value cannot be
              reused elsewhere, and kept in a database schema the public API
              does not expose. Spotify authorizations expire after six months,
              at which point this page will ask you to reconnect.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
