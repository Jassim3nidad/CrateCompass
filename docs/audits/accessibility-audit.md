# CrateCompass accessibility audit

Phase: 11 · Date: 2026-08-10 · Commit audited: `4619141`
Target: WCAG 2.2 Level AA
Method: automated scanning (axe-core 4.12 via Playwright, Lighthouse 12.8.2)
plus manual review of markup, focus behaviour, and motion.

---

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Informational | 2 |

No automatically detectable violation exists on any scanned surface. Lighthouse
reports an accessibility score of 100 on all three sampled routes. The findings
below are gaps in *coverage* and in criteria automation cannot reach, not
observed failures.

---

## Automated results

**axe-core** — 54 accessibility tests pass across the Chromium and mobile
Chromium projects, with zero violations. Scanned surfaces:

| Surface | Anonymous | Authenticated |
| --- | --- | --- |
| `/` | ✓ | |
| `/discover` (empty and with results) | ✓ | |
| `/mood` | ✓ | ✓ (full workflow) |
| `/artists/{mbid}` | ✓ | |
| `/artists/not-an-mbid` | ✓ | |
| `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password` | ✓ | |
| 404 | ✓ | |
| `/library`, `/history` | | ✓ |
| `/settings`, `/settings/connections` | | ✓ |

**Lighthouse 12.8.2**, production build, headless Chromium:

| Route | Accessibility | Best practices | SEO | Performance | CLS |
| --- | --- | --- | --- | --- | --- |
| `/` | 100 | 100 | 100 | 94 | 0 |
| `/discover` | 100 | 100 | 100 | 93 | 0 |
| `/artists/{mbid}` | 100 | 100 | 100 | 96 | 0 |

CLS of 0 on every route confirms the Phase 10 entrance animations are composited
transform and opacity, not layout.

**States scanned as states, not assumed.** A 3.88:1 contrast defect once
survived two phases here because no button was ever hovered during a scan.
Hovered states on the library controls and discography filter chips, and the
expanded explanation panel and open mobile menu, are now scanned explicitly.

---

## Criteria verified by interaction test, not by scanner

These are the criteria axe cannot evaluate. Each has a dedicated test in
`tests/e2e/accessibility.spec.ts` or `tests/e2e/responsive.spec.ts`.

| Criterion | Coverage |
| --- | --- |
| 2.1.1 Keyboard | Discovery card actions reachable and operable; tab order save → dismiss → Spotify asserted |
| 2.1.2 No keyboard trap | Forty-tab sweep across four routes asserts no element captures focus |
| 2.4.3 Focus order | Skip link is the first stop; mobile menu returns focus to its trigger on Escape |
| 2.4.7 Focus visible | Computed `outlineWidth` asserted non-zero when an element is reached by Tab |
| 2.4.11 Focus not obscured | Sticky header is 4.25rem with no overlay; open menu does not cover its own trigger |
| 1.4.10 Reflow | No horizontal scrolling at 320–1920px across 9 routes (63 cases), plus a 640px 200%-zoom case |
| 2.5.8 Target size | Every button, summary, input, select and textarea measured ≥ 24×24; product floor is 44px |
| 2.3.3 Animation from interactions | Under `prefers-reduced-motion: reduce`, `animationName` computes to `none` on every motion utility |
| 4.1.3 Status messages | `role="status"` / `aria-live="polite"` regions on discovery, library, history, mood and Q&A |

**Reduced motion is structurally correct, not merely suppressed.** The motion
utilities are declared inside `@media (prefers-reduced-motion: no-preference)`,
so a reduced-motion user has no animation applied at all rather than one
compressed to 0.01ms. A second test asserts no `.page-shell` rests below full
opacity — the failure mode where content becomes permanently invisible because
the animation that would have revealed it was suppressed.

---

## A11Y-01 · Colour contrast is verified only where a test hovers — **Medium**

Contrast is scanned in the resting state everywhere, and in the hovered state on
exactly two surfaces (library controls, discography filter chips). Hover, focus,
active, selected and disabled states elsewhere are unscanned.

This is the same shape as the defect that previously escaped for two phases. The
token set is now disciplined — `--violet-soft` at 7.9:1 exists precisely so text
never uses the 3.6:1 fill colour — so the risk is lower than it was, but "lower"
is not "measured".

Disabled controls are the specific gap worth naming: `disabled:opacity-45` on
`Button` reduces `--foreground` on `--surface` well below 4.5:1. WCAG exempts
disabled controls from 1.4.3, so this is conformant; it is listed because the
exemption is a legal position, not a usability one, and a listener who cannot
read a disabled button cannot tell why an action is unavailable.

Recommend extending the hovered-state scan to the primary, accent and
destructive button variants, and to the nav links.

---

## A11Y-02 · No screen-reader pass has been performed — **Low**

Everything above is automated or programmatic. No NVDA, JAWS or VoiceOver
session has been run against any flow.

Automation confirms that live regions exist and carry the right roles. It cannot
confirm that the resulting announcements are coherent — that the mood workflow's
staged progress reads sensibly as it advances, that the discovery undo banner
announces before focus moves to it, or that the Q&A provenance caption is
understood as qualifying the answer above it rather than as new content.

The markup shows care here that deserves confirmation: `question-panel.tsx`
deliberately clears its live region rather than restating the outcome, precisely
so a screen reader does not announce the same sentence twice.

One manual pass across sign-in, discovery, mood and library before the pilot.

---

## A11Y-03 · Zoom verified at 200%, not 400% — **Low**

`tests/e2e/responsive.spec.ts` asserts reflow at a 640px viewport, equivalent to
200% zoom on a 1280px laptop, and separately asserts no horizontal overflow at
320px.

WCAG 2.2 §1.4.10 is formally measured at 1280×1024 scaled to 400%, which is
320×256 CSS pixels. The width half of that is covered by the 320px cases; the
**height** half — 256 CSS pixels of vertical space — is not tested anywhere. The
sticky header at 4.25rem consumes a fifth of that viewport, which is the
component most likely to make content unreachable at extreme zoom.

---

## A11Y-04 · Forced-colors mode is untested — **Informational**

No test exercises Windows High Contrast / `forced-colors: active`. The Phase 10
switch from a `box-shadow` ring to an `outline` focus indicator improves this
materially — `box-shadow` is discarded in forced-colors mode while `outline` is
preserved — but the improvement is reasoned rather than observed.

Surfaces most likely to degrade: the `color-mix()` backgrounds on status badges
and error states, which carry meaning through tint, and the SVG relationship
motif, whose strokes use custom properties.

---

## A11Y-05 · Motion coverage is asserted at the CSS layer — **Informational**

The reduced-motion tests assert that no animation is *applied*. They do not
assert that the interface remains comprehensible without motion — for example
that the mood workflow's stage transitions are still legible when the connector
rail changes colour instantly.

Reviewed manually and found sound: every animated state change is also carried
by a non-motion signal (icon swap, colour, text, `aria-live`). Recorded so the
property is stated rather than assumed by the next person adding an animation.

---

## Structural review — verified by reading

**Landmarks.** One `<header>`, one `<main id="main-content" tabIndex={-1}>`, one
`<footer>` per page, from the root layout. Navigation regions carry distinct
accessible names — "Primary navigation", "Mobile navigation", "Footer
navigation" — so a screen-reader rotor can tell them apart.

**Headings.** Exactly one `<h1>` per route, supplied by `PageHeader` or the page
itself. The authenticated axe cases wait on the `<h1>` before scanning, which
means a route that lost its heading would fail the suite rather than pass it
silently.

**Forms.** Every input has an associated `<label>`. `FieldDescription` and
`FieldError` are wired through `aria-describedby`; errors carry `role="alert"`
and `aria-invalid`. Error identification (3.3.1) and labels (3.3.2) are
satisfied on the auth, profile, deletion, mood and Q&A forms.

**The mobile menu** implements the disclosure contract it claims: `aria-expanded`
on the trigger, `aria-controls` to the panel, Escape closes and restores focus,
outside pointer or focus dismisses. It deliberately does not trap focus, which
is correct — there is no backdrop and the page behind remains operable, so
trapping would hold focus hostage for a non-modal control.

**No dialogs exist.** Both destructive flows use inline confirmation instead:
bulk library deletion states its real count before the irreversible click, and
account deletion requires the password plus a typed `DELETE`. There is therefore
no modal focus trap to audit — the accessible-dialog requirement is satisfied by
not having any.

**Reading order and language.** `<html lang="en">`. DOM order matches visual
order; no `order` or `grid-area` reordering is used anywhere.

---

## Verdict

**Conformant to WCAG 2.2 AA on every criterion tested, with no known
violations.** The residual risk is concentrated in what has not been tested —
one screen-reader pass, contrast in interaction states beyond hover, 400% zoom
height, and forced-colors — rather than in anything observed to be broken.

A11Y-01 and A11Y-02 are worth closing before the pilot. A11Y-03 through A11Y-05
are appropriate to carry.
