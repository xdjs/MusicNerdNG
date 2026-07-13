import { AspectRatio, Badge } from "musicnerdweb";

/**
 * A 1:1 artist artwork tile — the shape Spotify images arrive in. AspectRatio is a bare
 * Radix re-export with no styling of its own: it only reserves the box (padding-bottom
 * trick), so it renders as nothing unless the parent has a width AND it has a child.
 * Here the parent is `w-64` and the child is an absolutely-filled brand gradient standing
 * in for the artwork.
 */
export const Square = () => (
  <div className="w-64">
    <AspectRatio ratio={1}>
      <div className="flex h-full w-full items-end rounded-lg bg-gradient-to-br from-pastypink via-[#7c3aed] to-pastyblue p-3">
        <span className="rounded bg-black/40 px-2 py-1 text-sm font-medium text-white">
          Floating Points
        </span>
      </div>
    </AspectRatio>
  </div>
);

/**
 * 16:9 — the ratio the Spotify/YouTube embeds on the artist page need. Same component,
 * only `ratio` changes; the wrapper width is identical to the 1:1 story above, so the
 * height difference is entirely the ratio doing its job.
 */
export const Video = () => (
  <div className="w-80">
    <AspectRatio ratio={16 / 9}>
      <div className="flex h-full w-full items-center justify-center rounded-lg border bg-muted">
        <span className="text-sm text-muted-foreground">Spotify embed · 16:9</span>
      </div>
    </AspectRatio>
  </div>
);

/**
 * The ratio axis in one row: 1:1 (artwork), 4:3, 16:9 (embed), 3:4 (portrait press shot).
 * Equal-width columns, so each box's height is a direct readout of its ratio.
 */
export const RatioScale = () => (
  <div className="grid w-[520px] grid-cols-4 items-start gap-3">
    {[
      ["1:1", 1, "from-pastypink to-[#7c3aed]"],
      ["4:3", 4 / 3, "from-pastyblue to-jellygreen"],
      ["16:9", 16 / 9, "from-jellygreen to-pastyblue"],
      ["3:4", 3 / 4, "from-[#7c3aed] to-pastypink"],
    ].map(([label, ratio, grad]) => (
      <div key={label as string} className="space-y-1.5">
        <AspectRatio ratio={ratio as number}>
          <div className={`h-full w-full rounded-md bg-gradient-to-br ${grad}`} />
        </AspectRatio>
        <p className="text-center text-xs text-muted-foreground">{label as string}</p>
      </div>
    ))}
  </div>
);

/**
 * In situ: an artwork tile inside a card, with the genre badge below. This is the whole
 * point of the component in a music directory — the grid stays on a rigid baseline even
 * before any image has loaded, so a slow Spotify CDN never reflows the page.
 */
export const InArtistCard = () => (
  <div className="w-56 overflow-hidden rounded-lg border bg-card shadow-sm">
    <AspectRatio ratio={1}>
      <div className="h-full w-full bg-gradient-to-br from-[#ff9ce3] via-pastypink to-pastyblue" />
    </AspectRatio>
    <div className="space-y-2 p-3">
      <p className="font-medium leading-none">Yaeji</p>
      <p className="text-xs text-muted-foreground">9 platform links</p>
      <Badge variant="secondary">house</Badge>
    </div>
  </div>
);
