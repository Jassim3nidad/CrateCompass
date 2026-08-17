"use client";

import {
  ExternalLink,
  MessageCircleQuestion,
  TriangleAlert,
} from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldDescription, Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { askQuestionAction } from "@/features/discography/actions";
import type { AnswerProvenance, AskResult } from "@/features/discography/state";
import type { ConversationMessage } from "@/features/discography/repository";

/**
 * The Q&A panel.
 *
 * Every answer here is grounded in retrieved MusicBrainz records and carries the
 * releases it cited. "The records do not say" is rendered as an ordinary
 * outcome rather than an error, because it is one — it is the honest answer the
 * product promises instead of a plausible sentence.
 *
 * The provenance caption travels with the answer it qualifies rather than
 * sitting at the foot of the page. A degraded answer with no visible indicator
 * is exactly the defect the silent release-group truncation was.
 */

export function QuestionPanel({
  artistMbid,
  artistName,
  signedIn,
  remainingQuota,
  initialMessages,
  suggestions,
}: {
  readonly artistMbid: string;
  readonly artistName: string;
  readonly signedIn: boolean;
  /** Null when the count could not be read; the figure is then omitted. */
  readonly remainingQuota: number | null;
  readonly initialMessages: readonly ConversationMessage[];
  /**
   * Derived from the retrieved timeline by `suggestedQuestions`, so every
   * prompt offered is one these records can answer. Empty on a sparse artist,
   * and the block is then omitted rather than padded.
   */
  readonly suggestions: readonly string[];
}) {
  const questionId = useId();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pending, startTransition] = useTransition();

  function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    setResult(null);
    setAnnouncement("Checking the retrieved records.");

    startTransition(async () => {
      const outcome = await askQuestionAction({
        artistMbid,
        question: trimmed,
      });

      setResult(outcome);
      // Cleared rather than restated. Every outcome below renders inside its
      // own `role="status"` or `role="alert"` container, so repeating the text
      // here would announce the same sentence to a screen reader twice.
      setAnnouncement("");
    });
  }

  return (
    <Card variant="raised">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Ask about the records</CardTitle>
            <CardDescription>
              Answers come only from the MusicBrainz releases retrieved above,
              and cite the ones they used.
            </CardDescription>
          </div>
          <MessageCircleQuestion
            aria-hidden="true"
            className="size-6 shrink-0 text-[var(--accent-foreground)]"
          />
        </div>
      </CardHeader>

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {initialMessages.length > 0 ? (
        <details className="surface-sunken elev-inset mb-4 rounded-[var(--r-md)] p-3">
          <summary className="cursor-pointer text-sm text-[var(--muted)]">
            Earlier questions about {artistName} ({initialMessages.length})
          </summary>
          <ol className="mt-3 space-y-2">
            {initialMessages.map((message) => (
              <li key={message.id} className="text-sm leading-6">
                <span className="text-[var(--muted-dim)]">
                  {message.role === "user" ? "You asked" : "Answer"}
                </span>
                <span className="mt-0.5 block text-[var(--foreground)]">
                  {message.content}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <div className="space-y-4">
        <div>
          <Label htmlFor={questionId}>Your question</Label>
          <Textarea
            id={questionId}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            maxLength={2000}
            disabled={!signedIn}
            placeholder="What was their first studio album?"
            aria-describedby={`${questionId}-description`}
            className="mt-2"
          />
          <FieldDescription id={`${questionId}-description`}>
            Factual questions about releases only. Nothing from Spotify is used
            to answer, and opinions are not answered from records.
          </FieldDescription>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="accent"
            onClick={() => ask(question)}
            disabled={pending || !signedIn || question.trim().length === 0}
          >
            {pending ? "Checking the records…" : "Ask"}
          </Button>

          {signedIn && remainingQuota !== null ? (
            <p className="text-xs text-[var(--muted-dim)]">
              {remainingQuota} AI request{remainingQuota === 1 ? "" : "s"} left
              today.
            </p>
          ) : null}
        </div>

        {signedIn ? (
          suggestions.length > 0 ? (
            <div>
              <p className="text-xs text-[var(--muted-dim)]">
                Questions these records can answer:
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion}
                    className="motion-rise motion-stagger"
                    style={{ "--stagger-index": index } as React.CSSProperties}
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        setQuestion(suggestion);
                        ask(suggestion);
                      }}
                    >
                      {suggestion}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Sign in to ask questions. Browsing the releases above needs no
            account.
          </p>
        )}

        {result ? <Outcome result={result} /> : null}
      </div>
    </Card>
  );
}

function Outcome({ result }: { readonly result: AskResult }) {
  if (result.status === "answered") {
    return (
      <div
        role="status"
        className="surface-sunken elev-inset rounded-[var(--r-md)] p-4"
      >
        <p className="text-sm leading-6 whitespace-pre-line text-[var(--foreground)]">
          {result.answer}
        </p>

        {result.citations.length > 0 ? (
          <>
            <p className="mt-4 text-xs font-semibold text-[var(--muted-dim)]">
              Drawn from these records
            </p>
            <ul className="mt-2 space-y-1">
              {result.citations.map((citation) => (
                <li key={citation.mbid} className="text-xs">
                  <span className="text-[var(--foreground)]">
                    {citation.title}
                  </span>
                  {citation.year ? (
                    <span className="text-[var(--muted-dim)]">
                      {" "}
                      ({citation.year})
                    </span>
                  ) : null}
                  {citation.sourceUrl ? (
                    <a
                      href={citation.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="focus-ring ml-2 inline-flex items-center gap-1 rounded text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
                    >
                      <ExternalLink aria-hidden="true" className="size-3" />
                      MusicBrainz
                      <span className="sr-only">
                        record for {citation.title} (opens in a new tab)
                      </span>
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <Provenance provenance={result.provenance} />
      </div>
    );
  }

  if (result.status === "insufficient-context") {
    return (
      <div
        role="status"
        className="surface-sunken elev-inset rounded-[var(--r-md)] p-4"
      >
        <p className="text-sm leading-6 text-[var(--foreground)]">
          {result.reason}
        </p>
        <p className="mt-2 text-xs text-[var(--muted-dim)]">
          Nothing has been guessed. This is what the retrieved records support.
        </p>
        <Provenance provenance={result.provenance} />
      </div>
    );
  }

  return (
    <p role="alert" className="text-sm leading-6 text-[var(--danger-soft)]">
      {result.message}
    </p>
  );
}

/**
 * The two partial signals, rendered where the claim is.
 *
 * `contextTruncated` and `retrievalComplete` are different failures and are
 * said separately: a complete discography can still be truncated for one broad
 * question, and a partial retrieval can still answer a narrow one completely.
 */
function Provenance({ provenance }: { readonly provenance: AnswerProvenance }) {
  if (provenance.retrievalComplete && !provenance.contextTruncated) {
    return (
      <p className="mt-3 text-xs text-[var(--muted-dim)]">
        Answered from all {provenance.totalAvailable.toLocaleString()} release
        groups MusicBrainz records.
      </p>
    );
  }

  return (
    // No role of its own: this always renders inside an outcome container that
    // is already a status region, and nesting them announces twice.
    <p className="mt-3 flex gap-2 text-xs leading-5 text-[var(--amber-soft)]">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {provenance.contextTruncated
          ? `Answered from ${provenance.consultedCount.toLocaleString()} of ${provenance.totalAvailable.toLocaleString()} releases, selected by relevance to your question.`
          : null}
        {provenance.contextTruncated && !provenance.retrievalComplete
          ? " "
          : null}
        {provenance.retrievalComplete
          ? null
          : "The full discography could not be retrieved, so this answer may be incomplete."}
      </span>
    </p>
  );
}
