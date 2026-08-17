import { cn } from "@/lib/utils";

export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // A skeleton is a well waiting to be filled — elev-inset regardless
        // of what it's placed inside, which is always nesting-safe.
        "elev-inset rounded-[var(--r-md)] bg-[linear-gradient(110deg,var(--surface-subtle)_25%,var(--surface-raised)_42%,var(--surface-subtle)_55%)] bg-[length:200%_100%] motion-safe:animate-[skeleton_1.6s_ease-in-out_infinite]",
        className,
      )}
    />
  );
}
