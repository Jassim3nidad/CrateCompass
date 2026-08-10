import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("home page", () => {
  it("states the independent discovery value and exposes primary paths", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: /find the thread between records/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /start with an artist/i }),
    ).toHaveAttribute("href", "/discover");
    expect(
      screen.getByRole("link", { name: /describe a mood/i }),
    ).toHaveAttribute("href", "/mood");
  });

  it("names the relationship motif as drawn rather than retrieved", () => {
    render(<Home />);

    // The illustration is the one place on the page that could be mistaken for
    // provider data. It carries an accessible name saying it is an
    // illustration, and a caption saying it names no providers because it
    // reports nothing — both are load-bearing, not decoration.
    expect(
      screen.getByRole("img", { name: /illustration of the discovery model/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/drawn rather than retrieved/i)).toBeVisible();
  });

  it("carries no phase-preview scaffolding", () => {
    render(<Home />);

    // Phases 1 through 9 shipped; copy telling a listener that a feature
    // "arrives in Phase N" outlived every one of them. This asserts the class
    // of defect, not the one string that was removed.
    expect(screen.queryByText(/foundation preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/arrives in phase/i)).not.toBeInTheDocument();
  });
});
