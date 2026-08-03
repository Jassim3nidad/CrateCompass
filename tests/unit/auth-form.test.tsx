import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(async () => ({
    status: "error" as const,
    message: "Review the highlighted fields.",
    fieldErrors: {
      email: ["Enter a valid email address."],
      password: ["Enter your password."],
    },
  })),
}));

vi.mock("@/features/auth/actions", () => ({
  signIn: authMocks.signIn,
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
}));

import { AuthForm } from "@/features/auth/components/auth-form";

describe("authentication form", () => {
  it("announces server validation messages and preserves accessible fields", async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="sign-in" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Enter a valid email address."),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByText("Enter your password.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(authMocks.signIn).toHaveBeenCalledOnce();
  });
});
