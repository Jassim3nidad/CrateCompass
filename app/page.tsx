import {
  ArrowRight,
  BookOpenText,
  Compass,
  Library,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RelationshipMotif } from "@/components/ui/relationship-motif";

const valueCards = [
  {
    title: "Trace the relationship",
    description:
      "Start with one canonical artist and follow sourced connections without pretending similarity is a fact without evidence.",
    icon: Compass,
    accent: "text-[var(--amber-soft)]",
  },
  {
    title: "Name the feeling",
    description:
      "Write the room, weather, pace, and edges of a mood. CrateCompass turns language into reviewable discovery criteria.",
    icon: Sparkles,
    accent: "text-[var(--accent-foreground)]",
  },
  {
    title: "Read the discography",
    description:
      "Explore albums, EPs, singles, dates, and relationships through canonical MusicBrainz context with visible references.",
    icon: BookOpenText,
    accent: "text-[var(--accent-foreground)]",
  },
] as const;

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="compass-grid absolute inset-0" />
        <div className="page-shell relative grid items-start gap-12 py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.65fr)]">
          <div className="max-w-4xl">
            {/* The hero, led by the thing the product actually does rather
                than an eyebrow-plus-headline asserting it. A trail is what
                every other page in the app shows as evidence; showing one
                here, honestly labelled as a sample, does the same work the
                old giant headline was reaching for without the generic
                hero-pattern shape (letterspaced caps -> huge serif -> gray
                subtext) that shape has everywhere else on the web. */}
            <p className="text-xs font-medium tracking-[0.18em] text-[var(--muted-dim)] uppercase">
              A sample trail
            </p>
            <dl className="mt-4 border-t-[3px] border-double border-[var(--border-strong)] font-mono text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--border)] py-2.5">
                <dt className="w-20 shrink-0 text-xs tracking-[0.1em] text-[var(--muted-dim)] uppercase">
                  Seed
                </dt>
                <dd className="text-[var(--foreground)]">Radiohead</dd>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--border)] py-2.5">
                <dt className="w-20 shrink-0 text-xs tracking-[0.1em] text-[var(--muted-dim)] uppercase">
                  Related
                </dt>
                <dd className="text-[var(--foreground)]">
                  Sigur Rós{" "}
                  <span className="text-[var(--muted)]">
                    · strong link · 92% · via ListenBrainz
                  </span>
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 py-2.5">
                <dt className="w-20 shrink-0 text-xs tracking-[0.1em] text-[var(--muted-dim)] uppercase">
                  Evidence
                </dt>
                <dd className="text-[var(--muted)]">
                  shared tags: post-rock, art rock
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-[var(--muted-dim)]">
              Illustrative, not a live search — every real trail names its own
              provider, the way this one names ListenBrainz.
            </p>

            <h1 className="font-display mt-8 text-4xl leading-[1.05] tracking-[-0.04em] text-balance text-[var(--foreground)] sm:text-5xl">
              Find the thread{" "}
              <span className="text-[var(--muted-dim)]">between records.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              CrateCompass helps you understand why an artist might fit,
              translate a mood into a direction, and keep the discoveries worth
              returning to.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" variant="accent">
                <Link href="/discover">
                  Start with an artist
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/mood">Describe a mood</Link>
              </Button>
            </div>
          </div>

          <Card
            variant="raised"
            className="noise-surface relative overflow-hidden p-0"
          >
            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold tracking-[0.18em] text-[var(--amber-soft)] uppercase">
                    How a trail is shaped
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                    One seed, sourced connections
                  </h2>
                </div>
                <Compass
                  aria-hidden="true"
                  className="size-7 shrink-0 text-[var(--accent-foreground)]"
                />
              </div>
            </div>
            <div className="p-6">
              <RelationshipMotif
                className="mx-auto max-w-72"
                label="An illustration of the discovery model: one seed artist at the centre, with connections radiating to related artists."
              />
              <p className="mt-4 text-center text-sm leading-6 text-[var(--muted)]">
                Every connection you see in CrateCompass names the provider that
                reported it. This illustration names none, because it is drawn
                rather than retrieved.
              </p>
            </div>
          </Card>
        </div>
      </section>

      <section className="page-shell" aria-labelledby="why-heading">
        <div className="mb-10 max-w-2xl">
          <p className="text-xs font-bold tracking-[0.2em] text-[var(--amber-soft)] uppercase">
            Why CrateCompass
          </p>
          <h2
            id="why-heading"
            className="font-display mt-3 text-4xl tracking-[-0.04em] sm:text-5xl"
          >
            More context. Less black box.
          </h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {valueCards.map((item, index) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.title}
                variant={index === 1 ? "accent" : "default"}
                className="motion-rise motion-stagger min-h-64"
                style={{ "--stagger-index": index } as React.CSSProperties}
              >
                <Icon aria-hidden="true" className={`size-6 ${item.accent}`} />
                <h3 className="mt-14 text-2xl font-semibold tracking-[-0.035em]">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                  {item.description}
                </p>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="page-shell pt-0">
        <Card
          variant="quiet"
          className="grid gap-8 md:grid-cols-[auto_1fr_auto] md:items-center"
        >
          <span className="elev-inset grid size-12 place-items-center rounded-full bg-[var(--surface)] text-[var(--muted)]">
            <Library aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.025em]">
              Keep the trail, not the catalog.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Save canonical IDs, your notes, and meaningful discovery context.
              Spotify remains an optional destination—not the source of the
              recommendation.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/library">Open library</Link>
          </Button>
        </Card>
      </section>
    </>
  );
}
