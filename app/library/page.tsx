import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { LibraryBrowser } from "@/features/library/components/library-browser";
import {
  readLibraryPage,
  readTagVocabulary,
  type EntityFilter,
} from "@/features/library/repository";
import { isSortMode, type SortMode } from "@/lib/library/cursor";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Library" };

interface LibraryPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ENTITY_VALUES: readonly EntityFilter[] = [
  "all",
  "artist",
  "mood",
  "discography",
  "manual",
];

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const { user } = await getAuthenticatedUser();
  const params = await searchParams;

  const sortParam = single(params.sort);
  const sort: SortMode = isSortMode(sortParam) ? sortParam : "newest";

  const entityParam = single(params.type);
  const entity: EntityFilter = ENTITY_VALUES.includes(
    entityParam as EntityFilter,
  )
    ? (entityParam as EntityFilter)
    : "all";

  const tags = (single(params.tags) ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
    .slice(0, 20);

  const search = single(params.q);

  const [page, vocabulary] = await Promise.all([
    readLibraryPage({
      userId: user.id,
      sort,
      cursor: single(params.cursor),
      search,
      entity,
      tags,
    }),
    readTagVocabulary(user.id),
  ]);

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Personal library"
        title="The finds you chose to keep."
        description="Saved discoveries with the explanation that convinced you, plus your own notes and tags. Nothing here mirrors a streaming catalogue."
      />

      <LibraryBrowser
        items={page.items}
        matching={page.matching}
        total={page.total}
        vocabulary={vocabulary}
        search={search ?? ""}
        sort={sort}
        entity={entity}
        activeTags={tags}
      />
    </div>
  );
}
