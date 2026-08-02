import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ProviderStatus } from "@/components/ui/provider-status";

describe("foundation UI states", () => {
  it("renders an accessible empty state", () => {
    render(
      <EmptyState title="No discoveries" description="Start with an artist." />,
    );
    expect(
      screen.getByRole("heading", { name: "No discoveries" }),
    ).toBeVisible();
  });

  it("announces error states", () => {
    render(
      <ErrorState title="Provider stopped" description="Try again later." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Provider stopped");
  });

  it("labels provider readiness without color alone", () => {
    render(
      <ProviderStatus
        name="Spotify"
        status="not-configured"
        description="Optional connection is not configured."
      />,
    );
    expect(screen.getByText("not configured")).toBeVisible();
    expect(screen.getByText("Spotify")).toBeVisible();
  });
});
