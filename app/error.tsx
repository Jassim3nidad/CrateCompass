"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { logger } from "@/lib/observability/logger";

export default function ErrorBoundary({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    logger.error({
      event: "route_error",
      digest: error.digest ?? "unavailable",
    });
  }, [error.digest]);

  return (
    <div className="page-shell">
      <ErrorState
        title="This trail stopped unexpectedly"
        description="Your navigation is safe. Try this view again, or return to another part of CrateCompass."
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        }
      />
    </div>
  );
}
