"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getServerEnvironment } from "@/lib/env";
import { getSafeReturnPath } from "@/lib/security/safe-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AuthActionState } from "@/features/auth/state";

const emailSchema = z.string().trim().email("Enter a valid email address.");
const resetPasswordSchema = z.object({ email: emailSchema });
const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.");

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
  returnTo: z.string().optional(),
});

const signUpSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a display name.")
    .max(80, "Use 80 characters or fewer."),
  email: emailSchema,
  password: passwordSchema,
  returnTo: z.string().optional(),
});

const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your current password."),
  confirmation: z.literal("DELETE", {
    error: 'Type "DELETE" to confirm.',
  }),
});

const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a display name.")
    .max(80, "Use 80 characters or fewer."),
  preferredAiProvider: z.enum(["openai", "anthropic"]),
});

function invalidState(error: z.ZodError): AuthActionState {
  return {
    status: "error",
    message: "Review the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors,
  };
}

export async function signIn(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidState(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      status: "error",
      message:
        "The email or password is incorrect, or the email is unconfirmed.",
    };
  }

  redirect(getSafeReturnPath(parsed.data.returnTo));
}

export async function signUp(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidState(parsed.error);

  const supabase = await createClient();
  const environment = getServerEnvironment();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${environment.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(
        getSafeReturnPath(parsed.data.returnTo),
      )}`,
    },
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "user_already_exists"
          ? "An account may already exist for this email. Try signing in or resetting your password."
          : "We could not create the account. Please try again shortly.",
    };
  }

  if (data.session) {
    redirect(getSafeReturnPath(parsed.data.returnTo));
  }

  redirect(`/auth/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function requestPasswordReset(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidState(parsed.error);

  const supabase = await createClient();
  const environment = getServerEnvironment();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${environment.NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/update-password`,
  });

  return {
    status: "success",
    message:
      "If an account exists for that address, a password-reset link is on its way.",
  };
}

export async function updatePassword(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = updatePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidState(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return {
      status: "error",
      message: "The reset session is missing or expired. Request a new link.",
    };
  }

  redirect("/settings?password=updated");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function updateProfile(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = updateProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidState(parsed.error);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      status: "error",
      message: "Sign in again to update your profile.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      preferred_ai_provider: parsed.data.preferredAiProvider,
    })
    .eq("id", user.id);

  return error
    ? { status: "error", message: "Your profile could not be updated." }
    : { status: "success", message: "Profile updated." };
}

export async function deleteAccount(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = deleteAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalidState(parsed.error);

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return {
      status: "error",
      message: "Sign in again before deleting your account.",
    };
  }

  const { error: reauthenticationError } =
    await supabase.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.password,
    });

  if (reauthenticationError) {
    return { status: "error", message: "The current password is incorrect." };
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      return {
        status: "error",
        message: "The account could not be deleted. Please try again shortly.",
      };
    }
  } catch {
    return {
      status: "error",
      message: "Account deletion is temporarily unavailable.",
    };
  }

  await supabase.auth.signOut();
  redirect("/?account=deleted");
}
