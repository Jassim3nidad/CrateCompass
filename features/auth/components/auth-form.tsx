"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldDescription, FieldError, Label } from "@/components/ui/label";
import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from "@/features/auth/actions";
import { initialAuthActionState } from "@/features/auth/state";

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "update-password";

const actions = {
  "sign-in": signIn,
  "sign-up": signUp,
  "forgot-password": requestPasswordReset,
  "update-password": updatePassword,
} as const;

function SubmitButton({ mode }: { readonly mode: AuthMode }) {
  const { pending } = useFormStatus();
  const labels: Record<AuthMode, string> = {
    "sign-in": "Continue",
    "sign-up": "Create account",
    "forgot-password": "Send reset link",
    "update-password": "Update password",
  };

  return (
    <Button
      type="submit"
      variant="accent"
      className="w-full"
      disabled={pending}
    >
      {pending ? "Working…" : labels[mode]}
      <ArrowRight aria-hidden="true" className="size-4" />
    </Button>
  );
}

export function AuthForm({
  mode,
  returnTo,
}: {
  readonly mode: AuthMode;
  readonly returnTo?: string | undefined;
}) {
  const [state, formAction] = useActionState(
    actions[mode],
    initialAuthActionState,
  );
  const isSignIn = mode === "sign-in";
  const isSignUp = mode === "sign-up";
  const isForgotPassword = mode === "forgot-password";
  const showsEmail = mode !== "update-password";
  const showsPassword = !isForgotPassword;

  return (
    <form className="space-y-5" action={formAction} noValidate>
      {returnTo ? (
        <input type="hidden" name="returnTo" value={returnTo} />
      ) : null}

      {isSignUp ? (
        <div className="space-y-2">
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            name="displayName"
            autoComplete="name"
            aria-invalid={Boolean(state.fieldErrors?.displayName)}
            aria-describedby="display-name-error"
          />
          {state.fieldErrors?.displayName ? (
            <FieldError id="display-name-error">
              {state.fieldErrors.displayName[0]}
            </FieldError>
          ) : null}
        </div>
      ) : null}

      {showsEmail ? (
        <div className="space-y-2">
          <Label htmlFor={`${mode}-email`}>Email address</Label>
          <Input
            id={`${mode}-email`}
            name="email"
            type="email"
            autoComplete="email"
            aria-describedby={`${mode}-email-description ${mode}-email-error`}
            aria-invalid={Boolean(state.fieldErrors?.email)}
            placeholder="listener@example.com"
          />
          <FieldDescription id={`${mode}-email-description`}>
            Your CrateCompass identity remains separate from Spotify.
          </FieldDescription>
          {state.fieldErrors?.email ? (
            <FieldError id={`${mode}-email-error`}>
              {state.fieldErrors.email[0]}
            </FieldError>
          ) : null}
        </div>
      ) : null}

      {showsPassword ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${mode}-password`}>
              {mode === "update-password" ? "New password" : "Password"}
            </Label>
            {isSignIn ? (
              <Link
                href="/auth/forgot-password"
                className="text-xs text-[var(--muted)] underline underline-offset-4"
              >
                Forgot password?
              </Link>
            ) : null}
          </div>
          <Input
            id={`${mode}-password`}
            name="password"
            type="password"
            autoComplete={isSignIn ? "current-password" : "new-password"}
            aria-describedby={`${mode}-password-description ${mode}-password-error`}
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
          {!isSignIn ? (
            <FieldDescription id={`${mode}-password-description`}>
              Use 10+ characters with upper- and lowercase letters and a number.
            </FieldDescription>
          ) : null}
          {state.fieldErrors?.password ? (
            <FieldError id={`${mode}-password-error`}>
              {state.fieldErrors.password[0]}
            </FieldError>
          ) : null}
        </div>
      ) : null}

      {mode === "update-password" ? (
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
            aria-describedby="confirm-password-error"
          />
          {state.fieldErrors?.confirmPassword ? (
            <FieldError id="confirm-password-error">
              {state.fieldErrors.confirmPassword[0]}
            </FieldError>
          ) : null}
        </div>
      ) : null}

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "text-sm text-[var(--danger-soft)]"
              : "text-sm text-[var(--success-soft)]"
          }
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton mode={mode} />

      {isSignIn || isSignUp ? (
        <p className="text-center text-sm text-[var(--muted)]">
          {isSignIn ? "New to CrateCompass?" : "Already have an account?"}{" "}
          <Link
            className="font-semibold text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-[var(--foreground)]"
            href={isSignIn ? "/auth/sign-up" : "/auth/sign-in"}
          >
            {isSignIn ? "Create an account" : "Sign in"}
          </Link>
        </p>
      ) : null}
    </form>
  );
}
