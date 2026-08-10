# CrateCompass design system

Status: implemented in Phase 10
Last reviewed: 2026-08-10

The vocabulary the interface is built from, and the reasoning behind the parts
that are not obvious. Everything here is in `app/globals.css` unless stated
otherwise; this document explains the choices rather than duplicating the values.

---

## 1. Colour

A dark neutral foundation, warm off-white type, and one restrained accent
family. Spotify green is deliberately absent from the identity — it appears
nowhere outside Spotify's own attribution requirements.

| Token | Role |
| --- | --- |
| `--background`, `--surface`, `--surface-raised`, `--surface-subtle` | Four elevation surfaces, darkest to lightest |
| `--border`, `--border-strong` | Hairlines; `-strong` for anything raised |
| `--foreground`, `--muted`, `--muted-dim` | Text, in descending emphasis |
| `--violet`, `--violet-strong`, `--violet-soft` | The accent family |
| `--amber`, `--amber-soft` | Eyebrows, partial-result warnings |
| `--electric` | Discography and factual surfaces |
| `--success`, `--success-soft`, `--danger`, `--danger-soft` | Outcome states |
| `--focus` | The focus indicator, and only that |
| `--accent-soft` | Alias of `--violet-soft`, for accent-coloured text |

### The fill/foreground split

`--violet` is a **fill** colour. On `--background` it measures 3.6:1, which
fails AA for text. `--violet-soft` is the **foreground** member of the same
family at 7.9:1 on `--background` and 7.4:1 on `--surface`.

This split is the fix for two real defects:

- `--accent-soft` was referenced by `/settings` and never defined. The
  declaration was invalid at computed-value time, so the link silently
  inherited body colour and lost its emphasis. It went unnoticed because an
  undefined custom property fails quietly.
- `#aa96ff` was hard-coded in two places on the home page — a colour outside the
  token set doing exactly the job `--violet-soft` now names.

`--violet-strong` is *deeper* than `--violet`, not lighter, because it backs the
accent button's white text. An earlier `#856cf0` gave 3.88:1 there and survived
two phases: automated scans never hovered a button. Hover states are now scanned
explicitly.

---

## 2. Focus

One class, `.focus-ring`, applied to every interactive element.

```css
.focus-ring:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: var(--focus-ring-offset, 2px);
}
```

It replaced a 90-character Tailwind ring string repeated at fourteen call sites
in two mutually inconsistent variants. `outline` rather than `ring` + `ring-offset`
is a correctness change, not only a tidying one: the Tailwind offset paints a
solid band of a **fixed** colour, so the same class produced a correct halo on
the page background and a dark seam inside a lighter card. An outline follows
`border-radius`, needs no background colour, and survives forced-colors mode,
where `box-shadow` is discarded.

---

## 3. Motion

Four durations, two curves, one stagger step. A transition is chosen from the
scale rather than invented per component.

| Token | Value | Used for |
| --- | --- | --- |
| `--duration-fast` | 120ms | Hover and colour changes |
| `--duration-base` | 200ms | Disclosure, expansion |
| `--duration-slow` | 320ms | Page and card entrance |
| `--duration-slower` | 560ms | The relationship motif |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Everything entering |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Reversible state changes |
| `--stagger-step` | 55ms | Per-item delay in a list |

### Utilities

`.motion-rise`, `.motion-settle`, `.motion-expand`, `.motion-confirm`,
`.motion-orbit`, `.motion-draw`, and `.motion-stagger`, which composes with any
of them via a `--stagger-index` custom property.

### The reduced-motion contract

The utilities are declared **inside** `@media (prefers-reduced-motion: no-preference)`,
not neutralised afterwards by the global `animation-duration: 0.01ms !important`
block. Two consequences, both intended:

1. An element's resting state is its natural one. Nothing depends on an
   `!important` override landing correctly, and no element can be left stranded
   at `opacity: 0` because the animation that would have revealed it was
   suppressed. `tests/e2e/accessibility.spec.ts` asserts both — that
   `animationName` computes to `none` under `reduce`, and that no `.page-shell`
   sits below full opacity.
2. A reduced-motion user has no animation applied at all, rather than one
   compressed to a near-zero duration.

The global reduce block stays as a backstop for third-party animation — Sonner's
toasts, chiefly — that the application does not author.

### Where motion is used

| Surface | Effect |
| --- | --- |
| Page entrance | `.page-shell` settles in. It is the per-route wrapper and unmounts on navigation, so this runs once per view with no client-side transition coordinator and no delay to the navigation itself |
| Discovery cards | Staggered rise, capped at index 6 so "load more" cannot hand the twenty-fourth card a 1.3s delay |
| Explanation panel | Expands on open. `hidden` is `display: none`, which takes it out of the box tree, so the entrance replays on every reopen |
| Save confirmation | One-shot pop on the button; the colour, icon and label change carry the meaning, and the pop only draws the eye |
| Mood workflow | Connector rail fills as each stage completes; the check pops at the moment of completion |
| Relationship motif | Edges draw outward from the seed, then nodes settle — the order the real discovery flow resolves in |

Nothing loops. Every animation here plays once, on mount or on an explicit state
change.

---

## 4. Layout and elevation

`--radius-lg` (1.5rem) for cards, `--radius-md` (1rem) for inner panels, full
rounding for controls. Three elevation steps, `--elevation-1` through `-3`,
replacing per-component shadow literals.

`.page-shell` caps content at 90rem and uses fluid `clamp()` padding, so there
are no breakpoint jumps in the gutters.

### Responsive floor

`body { min-width: 320px }`. Grid tracks use `minmax(0, …)` rather than bare
`1fr`, which is what keeps a long unbroken string from widening its column.

`tests/e2e/responsive.spec.ts` asserts `scrollWidth <= clientWidth` on nine
routes at 320, 375, 768, 1024, 1280, 1440 and 1920 — 63 cases — plus a 200%-zoom
reflow case at 640 CSS pixels. On failure it names the widest offending element
rather than only reporting that something overflowed.

---

## 5. The mobile menu

A disclosure, not a dialog, and the distinction is deliberate.

It was a `<details>` element through Phase 9. That gave a working toggle and
nothing else a menu needs: Escape did not close it, a tap outside did not close
it, and following a link left it open behind the next page.
`components/layout/mobile-nav.tsx` implements the disclosure contract —
`aria-expanded`, `aria-controls`, Escape closes and returns focus to the
trigger, outside pointer and focus dismiss it.

It does **not** trap focus. There is no backdrop and the page behind stays
operable, so trapping would hold keyboard focus hostage for a control that is
merely open. The ARIA contract implemented is the one the markup claims.

Openness is derived rather than stored: the menu is open while the route is
still the one it was opened on, so navigating closes it during render —
including via the browser's own back and forward — with no effect
synchronising a boolean against the router.

One implementation note worth keeping: the navigation list is imported by the
client component rather than passed as a prop. Each entry carries a Lucide
icon component, and a function cannot be serialised across the server/client
boundary. Passing it as a prop compiles and typechecks, then fails at runtime.

---

## 6. Required interface states

Every interactive feature supports default, hover, focus-visible, active,
selected, disabled, loading, empty, error, partial-result, success, and
provider-unavailable.

Two are easy to get wrong and are called out:

- **Partial result** is a distinct state, not an error. A truncated discography
  and a failed retrieval are different facts and are said in different
  sentences.
- **Empty** distinguishes "nothing here yet" from "nothing matches your
  filters". They need different actions from the listener, so they get different
  copy.

---

## 7. Accessibility gate

WCAG 2.2 AA. What is automated, and where:

| Check | Location |
| --- | --- |
| axe on 10 anonymous routes + 4 authenticated | `tests/e2e/accessibility.spec.ts` |
| Hovered-state contrast | `discography.spec.ts`, `library.spec.ts` |
| Expanded/disclosed states | `accessibility.spec.ts` |
| Mobile menu: Escape, outside tap, `aria-expanded`, focus return | `accessibility.spec.ts` |
| Keyboard order and focus visibility on discovery actions | `accessibility.spec.ts` |
| No keyboard traps, four routes | `accessibility.spec.ts` |
| Reduced motion | `accessibility.spec.ts` |
| Horizontal overflow, 7 widths × 9 routes | `responsive.spec.ts` |
| 200% zoom reflow | `responsive.spec.ts` |
| Target size, WCAG 2.2 §2.5.8 | `responsive.spec.ts` |

Target size is measured against the 24×24 AA minimum, excluding inline links in
running text under the sentence exception. The product's own floor for buttons
is 44px.

**Automated scanning is the floor.** axe cannot see keyboard order, focus
visibility, or whether a menu can be dismissed, which is why each of those has
an explicit interaction case above rather than being assumed.
