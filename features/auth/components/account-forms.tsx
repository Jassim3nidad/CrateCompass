"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldDescription, FieldError, Label } from "@/components/ui/label";
import { deleteAccount, updateProfile } from "@/features/auth/actions";
import { initialAuthActionState } from "@/features/auth/state";

function PendingButton({
  children,
  variant = "accent",
}: {
  readonly children: React.ReactNode;
  readonly variant?: "accent" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

export function ProfileForm({
  displayName,
  preferredAiProvider,
}: {
  readonly displayName: string;
  readonly preferredAiProvider: string;
}) {
  const [state, formAction] = useActionState(
    updateProfile,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="settings-display-name">Display name</Label>
        <Input
          id="settings-display-name"
          name="displayName"
          defaultValue={displayName}
          autoComplete="name"
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
          aria-describedby="settings-display-name-error"
        />
        {state.fieldErrors?.displayName ? (
          <FieldError id="settings-display-name-error">
            {state.fieldErrors.displayName[0]}
          </FieldError>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="preferred-ai-provider">Preferred AI provider</Label>
        <select
          id="preferred-ai-provider"
          name="preferredAiProvider"
          defaultValue={preferredAiProvider}
          className="focus-ring min-h-12 w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm text-[var(--foreground)] transition-colors duration-[var(--duration-fast)] hover:border-[var(--muted-dim)] motion-reduce:transition-none"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <FieldDescription>
          This preference stores no provider credentials and sends no Spotify
          data.
        </FieldDescription>
      </div>
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className="text-sm"
        >
          {state.message}
        </p>
      ) : null}
      <PendingButton>Save profile</PendingButton>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, formAction] = useActionState(
    deleteAccount,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="delete-current-password">Current password</Label>
        <Input
          id="delete-current-password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby="delete-current-password-error"
        />
        {state.fieldErrors?.password ? (
          <FieldError id="delete-current-password-error">
            {state.fieldErrors.password[0]}
          </FieldError>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="delete-confirmation">Type DELETE to confirm</Label>
        <Input
          id="delete-confirmation"
          name="confirmation"
          autoComplete="off"
          aria-invalid={Boolean(state.fieldErrors?.confirmation)}
          aria-describedby="delete-confirmation-error"
        />
        {state.fieldErrors?.confirmation ? (
          <FieldError id="delete-confirmation-error">
            {state.fieldErrors.confirmation[0]}
          </FieldError>
        ) : null}
      </div>
      {state.message ? <FieldError>{state.message}</FieldError> : null}
      <PendingButton variant="destructive">
        Permanently delete account
      </PendingButton>
    </form>
  );
}
