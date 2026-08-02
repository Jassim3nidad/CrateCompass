"use client";

import { Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldDescription, Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const maximumLength = 600;

export function MoodForm() {
  const [mood, setMood] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toast.info("Mood interpretation arrives in Phase 5", {
      description: "Your text was not sent to an AI provider.",
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Label htmlFor="mood-description">Describe the moment</Label>
          <FieldDescription id="mood-description-hint" className="mt-1">
            Include setting, energy, era, textures, and anything to avoid.
          </FieldDescription>
        </div>
        <p
          className="text-xs text-[var(--muted-dim)] tabular-nums"
          aria-live="polite"
        >
          {mood.length}/{maximumLength}
        </p>
      </div>
      <Textarea
        id="mood-description"
        value={mood}
        maxLength={maximumLength}
        onChange={(event) => setMood(event.target.value)}
        aria-describedby="mood-description-hint"
        placeholder="Rain against the windows, low light, patient drums, no glossy pop…"
      />
      <Button type="submit" variant="accent" disabled={!mood.trim()}>
        <Sparkles aria-hidden="true" className="size-4" />
        Interpret mood
      </Button>
    </form>
  );
}
