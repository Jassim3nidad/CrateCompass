import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("home page foundation", () => {
  it("states the independent discovery value and exposes primary paths", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: /find the thread between records/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /start with an artist/i }),
    ).toHaveAttribute("href", "/discover");
    expect(screen.getByText(/no provider data is shown/i)).toBeVisible();
  });
});
