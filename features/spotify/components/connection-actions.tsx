"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/label";
import { connectSpotify, disconnectSpotify } from "@/features/spotify/actions";
import { initialSpotifyActionState } from "@/features/spotify/state";

function PendingButton({
  children,
  pendingLabel,
  variant = "accent",
}: {
  readonly children: React.ReactNode;
  readonly pendingLabel: string;
  readonly variant?: "accent" | "destructive" | "ghost";
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function ConnectSpotifyForm({
  label,
  disabled = false,
}: {
  readonly label: string;
  readonly disabled?: boolean;
}) {
  const [state, formAction] = useActionState(
    connectSpotify,
    initialSpotifyActionState,
  );

  if (disabled) {
    return (
      <Button type="button" variant="accent" disabled>
        {label}
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <PendingButton pendingLabel="Redirecting to Spotify…">
        {label}
      </PendingButton>
      {state.status === "error" && state.message ? (
        <FieldError role="alert">{state.message}</FieldError>
      ) : null}
    </form>
  );
}

export function DisconnectSpotifyForm() {
  const [state, formAction] = useActionState(
    disconnectSpotify,
    initialSpotifyActionState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <PendingButton pendingLabel="Disconnecting…" variant="destructive">
        Disconnect Spotify
      </PendingButton>
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className="text-sm text-[var(--muted)]"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
