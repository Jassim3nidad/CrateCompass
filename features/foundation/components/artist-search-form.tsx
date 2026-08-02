"use client";

import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldDescription, Label } from "@/components/ui/label";

export function ArtistSearchForm() {
  const [query, setQuery] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toast.info("Canonical artist search arrives in Phase 4", {
      description: query.trim()
        ? `“${query.trim()}” was not sent to a provider.`
        : "Enter an artist to preview the form state.",
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Label htmlFor="artist-search">Artist name</Label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="artist-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by artist name"
          aria-describedby="artist-search-description"
          className="flex-1"
        />
        <Button type="submit" variant="accent" className="sm:min-w-32">
          <Search aria-hidden="true" className="size-4" />
          Search
        </Button>
      </div>
      <FieldDescription id="artist-search-description">
        MusicBrainz will provide canonical identities before any recommendations
        are requested.
      </FieldDescription>
    </form>
  );
}
