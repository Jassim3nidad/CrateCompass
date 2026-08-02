import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AuthForm } from "@/features/auth/components/auth-form";

describe("authentication shell", () => {
  it("shows accessible validation messages without sending credentials", async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="sign-in" />);

    await user.type(screen.getByLabelText("Email address"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Enter a valid email address."),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByText("Use at least 8 characters.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
