import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldDescription, Label } from "@/components/ui/label";

/**
 * Canonical artist search.
 *
 * A plain GET form on purpose. The query belongs in the URL — it is the state
 * that decides what the page shows — which makes the result shareable, the
 * back button meaningful, and the search usable before any JavaScript loads.
 */
export function ArtistSearchForm({
  defaultQuery = "",
}: {
  readonly defaultQuery?: string;
}) {
  return (
    <form action="/discover" method="get" role="search" className="space-y-3">
      <Label htmlFor="artist-search">Artist name</Label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="artist-search"
          name="q"
          type="search"
          defaultValue={defaultQuery}
          placeholder="Search by artist name"
          aria-describedby="artist-search-description"
          autoComplete="off"
          className="flex-1"
        />
        <Button type="submit" variant="accent" className="sm:min-w-32">
          <Search aria-hidden="true" className="size-4" />
          Search
        </Button>
      </div>
      <FieldDescription id="artist-search-description">
        MusicBrainz supplies canonical identities. Pick the exact artist you
        mean before any recommendation is requested.
      </FieldDescription>
    </form>
  );
}
