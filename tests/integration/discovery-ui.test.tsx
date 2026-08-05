import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscoveryCandidate } from "@/lib/discovery/types";
import { asMusicBrainzId } from "@/types/music";

/**
 * Interaction and announcement behaviour for the discovery surface.
 *
 * Server actions are mocked at the module boundary, so these tests describe
 * what a listener experiences — including with a screen reader — rather than
 * what the server does.
 */

const actions = vi.hoisted(() => ({
  save: vi.fn(),
  unsave: vi.fn(),
  dismiss: vi.fn(),
  restore: vi.fn(),
  loadMore: vi.fn(),
  explain: vi.fn(),
  resolveSpotify: vi.fn(),
}));

vi.mock("@/features/discovery/actions", () => ({
  saveDiscoveryAction: actions.save,
  unsaveDiscoveryAction: actions.unsave,
  dismissDiscoveryAction: actions.dismiss,
  restoreDiscoveryAction: actions.restore,
  loadMoreCandidatesAction: actions.loadMore,
  explainDiscoveryAction: actions.explain,
}));

vi.mock("@/features/spotify/actions", () => ({
  resolveArtistOnSpotifyAction: actions.resolveSpotify,
}));

const { DiscoveryResults } =
  await import("@/features/discovery/components/discovery-results");
const { ExplanationPanel } =
  await import("@/features/discovery/components/explanation-panel");
const { SpotifyLink } =
  await import("@/features/discovery/components/spotify-link");

const SEED_MBID = "11111111-1111-4111-8111-111111111111";

function candidate(
  overrides: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
  return {
    mbid: asMusicBrainzId("22222222-2222-4222-8222-222222222222"),
    name: "Vellum Coast",
    disambiguation: "Edinburgh quartet",
    type: "Group",
    rank: 1,
    strength: "strong",
    relativeScore: 62,
    sourceUrl: "https://listenbrainz.org/artist/22222222",
    saved: false,
    ...overrides,
  };
}

function renderResults(candidates: readonly DiscoveryCandidate[]) {
  return render(
    <DiscoveryResults
      seedMbid={SEED_MBID}
      seedName="Harbour Lantern"
      initialCandidates={candidates}
      initialHasMore
      initialNextOffset={12}
      attributionUrl="https://listenbrainz.org/artist/seed"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("discovery results", () => {
  it("labels each result with its provider rank and relative strength", () => {
    renderResults([candidate()]);

    expect(screen.getByRole("heading", { name: "Vellum Coast" })).toBeVisible();
    expect(screen.getByText(/Provider rank/)).toBeInTheDocument();
    expect(screen.getByText("Strong link")).toBeVisible();
    expect(
      screen.getByText(
        /62% of the strongest similarity score within this result set/,
      ),
    ).toBeInTheDocument();
  });

  it("removes a dismissed card and offers an announced undo", async () => {
    const user = userEvent.setup();
    actions.dismiss.mockResolvedValue({
      status: "dismissed",
      message: "Dismissed.",
    });

    renderResults([candidate()]);
    await user.click(screen.getByRole("button", { name: /Dismiss/ }));

    expect(
      screen.queryByRole("heading", { name: "Vellum Coast" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Vellum Coast dismissed.",
    );
    expect(await screen.findByRole("button", { name: /Undo/ })).toBeVisible();
  });

  it("restores the card when the dismissal cannot be written", async () => {
    const user = userEvent.setup();
    actions.dismiss.mockResolvedValue({
      status: "auth-required",
      message: "Sign in to hide a suggestion for good.",
    });

    renderResults([candidate()]);
    await user.click(screen.getByRole("button", { name: /Dismiss/ }));

    expect(
      await screen.findByRole("heading", { name: "Vellum Coast" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Sign in");
  });

  it("appends the next page without duplicating a known candidate", async () => {
    const user = userEvent.setup();
    actions.loadMore.mockResolvedValue({
      status: "ready",
      candidates: [
        candidate(),
        candidate({
          mbid: asMusicBrainzId("33333333-3333-4333-8333-333333333333"),
          name: "Ash Meridian",
          rank: 2,
        }),
      ],
      hasMore: false,
      nextOffset: 24,
    });

    renderResults([candidate()]);
    await user.click(screen.getByRole("button", { name: /Load more/ }));

    expect(
      await screen.findByRole("heading", { name: "Ash Meridian" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("heading", { name: "Vellum Coast" }),
    ).toHaveLength(1);
  });

  it("reports a failed page load in an alert", async () => {
    const user = userEvent.setup();
    actions.loadMore.mockResolvedValue({
      status: "failed",
      failure: "provider-unavailable",
      message: "The discovery provider could not be reached.",
    });

    renderResults([candidate()]);
    await user.click(screen.getByRole("button", { name: /Load more/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be reached",
    );
  });

  it("invites an anonymous listener to sign in rather than failing silently", async () => {
    const user = userEvent.setup();
    actions.save.mockResolvedValue({
      status: "auth-required",
      message: "Sign in to keep this discovery in your library.",
    });

    renderResults([candidate()]);
    await user.click(screen.getByRole("button", { name: /^Save/ }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeVisible();
  });
});

describe("explanation panel", () => {
  const readyResult = {
    status: "ready" as const,
    source: "ai" as const,
    evidence: {
      rank: 2,
      totalCandidates: 25,
      strength: "strong" as const,
      relativeScore: 62,
      sharedTags: ["post-rock"],
      candidateOnlyTags: ["shoegaze"],
      sharedType: "Group",
      sharedCountry: "GB",
      startingPoint: null,
      depth: "full" as const,
      facts: [
        {
          source: "listenbrainz" as const,
          statement: "ListenBrainz ranks Vellum Coast #2 of 25.",
        },
      ],
      attributions: [],
    },
    inputDisclosure: null,
    explanation: {
      source: "ai" as const,
      summary: "Both are recorded under overlapping tags.",
      sharedCharacteristics: ["post-rock"],
      contrast: "Vellum Coast also carries shoegaze tags.",
      startingPoint: null,
      groundedIn: ["ListenBrainz ranks Vellum Coast #2 of 25."],
      confidence: "medium" as const,
      model: "test-model",
    },
  };

  function renderPanel() {
    return render(
      <ExplanationPanel
        seedMbid={SEED_MBID}
        seedName="Harbour Lantern"
        candidateMbid="22222222-2222-4222-8222-222222222222"
        candidateName="Vellum Coast"
      />,
    );
  }

  it("loads nothing until the listener asks", () => {
    renderPanel();

    expect(actions.explain).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Why this match/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the evidence above the reading of it", async () => {
    const user = userEvent.setup();
    actions.explain.mockResolvedValue(readyResult);

    renderPanel();
    await user.click(screen.getByRole("button", { name: /Why this match/ }));

    // Wait for the loading state to resolve before asserting on order.
    await screen.findByRole("heading", { name: "Evidence" });

    // The panel is labelled by its own disclosure button; the evidence and
    // reading sections are nested regions of their own.
    const region = screen.getByRole("region", { name: /Why this match/ });
    const headings = within(region).getAllByRole("heading");

    expect(headings[0]).toHaveTextContent("Evidence");
    expect(headings[1]).toHaveTextContent("Reading of the evidence");
    expect(
      within(region).getByText("ListenBrainz ranks Vellum Coast #2 of 25."),
    ).toBeVisible();
  });

  it("says why a summary is deterministic when the model was not used", async () => {
    const user = userEvent.setup();
    actions.explain.mockResolvedValue({
      ...readyResult,
      source: "template-rejected",
      explanation: {
        ...readyResult.explanation,
        source: "template",
        model: null,
      },
    });

    renderPanel();
    await user.click(screen.getByRole("button", { name: /Why this match/ }));

    expect(
      await screen.findByText(/made a claim the evidence did not support/),
    ).toBeVisible();
  });

  it("flags a partial result rather than presenting it as complete", async () => {
    const user = userEvent.setup();
    actions.explain.mockResolvedValue({
      ...readyResult,
      evidence: { ...readyResult.evidence, depth: "similarity-only" },
    });

    renderPanel();
    await user.click(screen.getByRole("button", { name: /Why this match/ }));

    expect(await screen.findByText(/could not be retrieved/)).toBeVisible();
  });

  it("warns that a free-tier provider trains on what the listener types", async () => {
    const user = userEvent.setup();
    actions.explain.mockResolvedValue({
      ...readyResult,
      inputDisclosure:
        "This deployment uses Google's free Gemini tier, where anything you type here is sent to Google and may be used to improve their products.",
    });

    renderPanel();
    await user.click(screen.getByRole("button", { name: /Why this match/ }));

    // The notice belongs beside the field it describes, not in a policy page.
    expect(
      await screen.findByText(/may be used to improve their products/),
    ).toBeVisible();
  });

  it("surfaces a failure with a retry rather than an empty panel", async () => {
    const user = userEvent.setup();
    actions.explain.mockResolvedValue({
      status: "failed",
      failure: "provider-unavailable",
      message: "MusicBrainz could not be reached.",
    });

    renderPanel();
    await user.click(screen.getByRole("button", { name: /Why this match/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "MusicBrainz could not be reached.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("Spotify linking", () => {
  it("resolves only when asked", () => {
    render(<SpotifyLink mbid={SEED_MBID} artistName="Vellum Coast" />);

    expect(actions.resolveSpotify).not.toHaveBeenCalled();
  });

  it("offers a choice instead of guessing when the match is ambiguous", async () => {
    const user = userEvent.setup();
    actions.resolveSpotify.mockResolvedValue({
      status: "ambiguous",
      reason: "2 Spotify artists match this name equally well.",
      options: [
        { url: "https://open.spotify.com/artist/a", name: "Vellum Coast" },
        { url: "https://open.spotify.com/artist/b", name: "Vellum Coast" },
      ],
    });

    render(<SpotifyLink mbid={SEED_MBID} artistName="Vellum Coast" />);
    await user.click(screen.getByRole("button", { name: /Find on Spotify/ }));

    expect(await screen.findAllByRole("link")).toHaveLength(2);
    expect(screen.getByText(/match this name equally well/)).toBeVisible();
  });

  it("points an unconnected listener at their connection settings", async () => {
    const user = userEvent.setup();
    actions.resolveSpotify.mockResolvedValue({
      status: "not-connected",
      message: "Connect Spotify to open results there.",
    });

    render(<SpotifyLink mbid={SEED_MBID} artistName="Vellum Coast" />);
    await user.click(screen.getByRole("button", { name: /Find on Spotify/ }));

    expect(
      await screen.findByRole("link", { name: "Manage connections" }),
    ).toBeVisible();
  });

  it("states plainly when no Spotify match could be resolved", async () => {
    const user = userEvent.setup();
    actions.resolveSpotify.mockResolvedValue({
      status: "unresolved",
      reason: "No Spotify result matched the canonical artist name.",
    });

    render(<SpotifyLink mbid={SEED_MBID} artistName="Vellum Coast" />);
    await user.click(screen.getByRole("button", { name: /Find on Spotify/ }));

    expect(await screen.findByText(/No Spotify result matched/)).toBeVisible();
  });
});
