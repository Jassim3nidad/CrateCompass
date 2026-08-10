import { cn } from "@/lib/utils";

/**
 * The relationship map, as a motif rather than a claim.
 *
 * This is the product's visual signature — a seed with sourced connections
 * radiating out of it — and it is deliberately abstract: unlabelled nodes,
 * because labelling them would put invented artist names on the marketing page
 * of a product whose whole argument is that it does not invent things.
 *
 * The entrance draws each edge outward from the seed, then settles the nodes,
 * which is the same order the real discovery flow resolves in. It plays once on
 * mount and then stops; nothing here loops.
 */

interface Node {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

const CENTRE = { x: 160, y: 140 } as const;

const NODES: readonly Node[] = [
  { cx: 160, cy: 34, r: 9 },
  { cx: 62, cy: 62, r: 7 },
  { cx: 260, cy: 74, r: 11 },
  { cx: 46, cy: 196, r: 10 },
  { cx: 250, cy: 212, r: 7 },
];

function edgeLength(node: Node): number {
  return Math.round(Math.hypot(node.cx - CENTRE.x, node.cy - CENTRE.y));
}

export function RelationshipMotif({
  className,
  label,
}: {
  readonly className?: string;
  /**
   * The accessible name. Required rather than optional: a decorative flourish
   * is fine, but this one carries meaning about the product, and every caller
   * so far has had a specific thing to say about it.
   */
  readonly label: string;
}) {
  return (
    <svg
      viewBox="0 0 320 280"
      role="img"
      aria-label={label}
      className={cn("h-auto w-full", className)}
    >
      <g>
        {NODES.map((node, index) => (
          <line
            key={`edge-${node.cx}-${node.cy}`}
            x1={CENTRE.x}
            y1={CENTRE.y}
            x2={node.cx}
            y2={node.cy}
            stroke="var(--border-strong)"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="motion-draw motion-stagger"
            style={
              {
                "--draw-length": edgeLength(node),
                "--stagger-index": index,
              } as React.CSSProperties
            }
          />
        ))}
      </g>

      <circle
        cx={CENTRE.x}
        cy={CENTRE.y}
        r={86}
        fill="none"
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="4 7"
        className="motion-orbit"
      />

      {NODES.map((node, index) => (
        <circle
          key={`node-${node.cx}-${node.cy}`}
          cx={node.cx}
          cy={node.cy}
          r={node.r}
          fill="var(--surface-raised)"
          stroke="var(--border-strong)"
          strokeWidth={1.5}
          className="motion-orbit motion-stagger"
          style={
            {
              "--stagger-index": index + 2,
            } as React.CSSProperties
          }
        />
      ))}

      <circle
        cx={CENTRE.x}
        cy={CENTRE.y}
        r={26}
        fill="var(--surface-raised)"
        stroke="color-mix(in srgb, var(--violet) 55%, var(--border))"
        strokeWidth={2}
        className="motion-orbit"
      />
      <circle
        cx={CENTRE.x}
        cy={CENTRE.y}
        r={7}
        fill="var(--violet-soft)"
        className="motion-orbit"
      />
    </svg>
  );
}
