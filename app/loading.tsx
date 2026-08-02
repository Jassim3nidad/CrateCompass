import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="page-shell" role="status" aria-label="Loading page">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-5 h-14 max-w-2xl" />
      <Skeleton className="mt-4 h-6 max-w-xl" />
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
