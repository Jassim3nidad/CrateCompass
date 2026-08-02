"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldDescription, FieldError, Label } from "@/components/ui/label";
import { PhaseNotice } from "@/components/ui/phase-notice";

const authSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

type AuthValues = z.infer<typeof authSchema>;

export function AuthForm({ mode }: { readonly mode: "sign-in" | "sign-up" }) {
  const isSignIn = mode === "sign-in";
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = () => {
    toast.info("Authentication is not connected yet", {
      description: "This validated shell will connect to Supabase in Phase 2.",
    });
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
      <PhaseNotice>
        Foundation preview only. Credentials are validated in the browser and
        are not sent or stored.
      </PhaseNotice>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-email`}>Email address</Label>
        <Input
          id={`${mode}-email`}
          type="email"
          autoComplete="email"
          aria-describedby={`${mode}-email-description ${mode}-email-error`}
          aria-invalid={Boolean(errors.email)}
          placeholder="listener@example.com"
          {...register("email")}
        />
        <FieldDescription id={`${mode}-email-description`}>
          Your CrateCompass identity will remain separate from Spotify.
        </FieldDescription>
        {errors.email ? (
          <FieldError id={`${mode}-email-error`}>
            {errors.email.message}
          </FieldError>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${mode}-password`}>Password</Label>
          {isSignIn ? (
            <span className="text-xs text-[var(--muted-dim)]">
              Reset arrives in Phase 2
            </span>
          ) : null}
        </div>
        <Input
          id={`${mode}-password`}
          type="password"
          autoComplete={isSignIn ? "current-password" : "new-password"}
          aria-describedby={`${mode}-password-description ${mode}-password-error`}
          aria-invalid={Boolean(errors.password)}
          {...register("password")}
        />
        <FieldDescription id={`${mode}-password-description`}>
          Use at least 8 characters for this foundation validation.
        </FieldDescription>
        {errors.password ? (
          <FieldError id={`${mode}-password-error`}>
            {errors.password.message}
          </FieldError>
        ) : null}
      </div>

      <Button
        type="submit"
        variant="accent"
        className="w-full"
        disabled={isSubmitting}
      >
        {isSignIn ? "Continue" : "Create account"}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>

      <p className="text-center text-sm text-[var(--muted)]">
        {isSignIn ? "New to CrateCompass?" : "Already have an account?"}{" "}
        <Link
          className="font-semibold text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-4 hover:decoration-[var(--foreground)]"
          href={isSignIn ? "/auth/sign-up" : "/auth/sign-in"}
        >
          {isSignIn ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
