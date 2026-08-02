import { Compass } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="page-shell grid min-h-[calc(100vh-13rem)] place-items-center text-center">
      <div>
        <Compass
          aria-hidden="true"
          className="mx-auto size-9 text-[var(--muted-dim)]"
        />
        <p className="mt-6 text-xs font-bold tracking-[0.2em] text-[var(--amber-soft)] uppercase">
          404 · Off the map
        </p>
        <h1 className="font-display mt-3 text-5xl tracking-[-0.045em]">
          That trail does not exist.
        </h1>
        <p className="mx-auto mt-4 max-w-md leading-7 text-[var(--muted)]">
          The address may have changed, or the discovery was never saved.
        </p>
        <Button asChild variant="secondary" className="mt-7">
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </div>
  );
}
