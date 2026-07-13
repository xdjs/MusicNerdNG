import { Badge } from "musicnerdweb";

/**
 * The four stock variants, side by side. Base is always
 * `rounded-full border px-2.5 py-0.5 text-xs font-semibold` — only the fill changes.
 * `outline` is the only variant with a visible border (the other three set
 * `border-transparent`), so it reads as the quietest of the set.
 */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>default</Badge>
    <Badge variant="secondary">secondary</Badge>
    <Badge variant="destructive">destructive</Badge>
    <Badge variant="outline">outline</Badge>
  </div>
);

/**
 * Genre pills on an artist record — the densest real use. `secondary` is the house style
 * for taxonomy; `outline` demotes a low-confidence tag the community hasn't confirmed.
 */
export const GenrePills = () => (
  <div className="max-w-sm space-y-3">
    <p className="text-sm font-medium">Jamie xx</p>
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">electronic</Badge>
      <Badge variant="secondary">uk garage</Badge>
      <Badge variant="secondary">house</Badge>
      <Badge variant="secondary">downtempo</Badge>
      <Badge variant="outline">+ unverified: trip hop</Badge>
    </div>
  </div>
);

/**
 * Status pills in the moderation and agent queues — the semantic axis. `default` (primary
 * fill) = approved, `outline` = pending, `destructive` = rejected, `secondary` = the
 * neutral machine-written state. Note DESIGN.md's warning: nothing in the component
 * enforces this mapping, so it lives entirely in convention at the call site.
 */
export const StatusPills = () => (
  <div className="max-w-md space-y-2 text-sm">
    {[
      ["Yaeji → Bandcamp", <Badge key="a">Approved</Badge>],
      ["Overmono → Deezer", <Badge key="b" variant="outline">Pending review</Badge>],
      ["Kelela → Tidal", <Badge key="c" variant="destructive">Rejected</Badge>],
      ["Four Tet → MusicBrainz", <Badge key="d" variant="secondary">Auto-mapped</Badge>],
    ].map(([label, badge], i) => (
      <div
        key={i}
        className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
      >
        <span className="text-muted-foreground">{label}</span>
        {badge}
      </div>
    ))}
  </div>
);

/**
 * Brand-tinted badges via `className` overrides — how confidence levels are colored in
 * the agent-work view. The pink here is the raw `#ff9ce3` literal users actually see,
 * not the `pastypink` token (#ef95ff); DESIGN.md flags the two as a real fragmentation.
 * Shown against `maroon` text, the brand's ink color.
 */
export const BrandTinted = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge className="bg-jellygreen text-maroon hover:bg-jellygreen">high confidence</Badge>
    <Badge className="bg-pastyblue text-maroon hover:bg-pastyblue">medium</Badge>
    <Badge className="bg-[#ff9ce3] text-maroon hover:bg-[#ff9ce3]">low</Badge>
    <Badge className="bg-pastypink text-maroon hover:bg-pastypink">manual</Badge>
  </div>
);
