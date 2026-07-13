import { Button } from "musicnerdweb";

/**
 * The full cva variant axis. Copy from the repo's own call sites: `outline` is the
 * workhorse (admin tables, leaderboard range pickers), `destructive` is reserved for
 * revoke/delete, `ghost` for low-emphasis row actions.
 *
 * Note the `default` variant has NO hover state — stock shadcn ships `hover:bg-primary/90`
 * and it was removed here (DESIGN.md, known inconsistency #9). That is the shipped
 * behavior, so the preview shows it truthfully rather than patching it.
 */
export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button>Add artist</Button>
    <Button variant="secondary">Save draft</Button>
    <Button variant="outline">Edit links</Button>
    <Button variant="ghost">Dismiss</Button>
    <Button variant="destructive">Revoke key</Button>
    <Button variant="link">View on Spotify</Button>
  </div>
);

/** Every size token. `icon` is a square 40px tap target used across the artist page. */
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
    <Button size="icon" aria-label="Bookmark">★</Button>
  </div>
);

/** Disabled is the one interactive state that renders statically. */
export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button disabled>Adding…</Button>
    <Button variant="outline" disabled>
      Searching…
    </Button>
    <Button variant="destructive" disabled>
      Revoke key
    </Button>
  </div>
);

/**
 * The brand move: shadcn Button restyled with the pastypink token via className.
 * This is exactly how EditModeToggle and BookmarkButton apply brand color — DESIGN.md is
 * explicit that identity lives at the custom-component layer, never by forking the primitive.
 */
export const BrandAccent = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button
      variant="outline"
      size="sm"
      className="border-pastypink/50 text-pastypink hover:bg-pastypink hover:text-white"
    >
      Edit mode
    </Button>
    <Button
      variant="outline"
      size="sm"
      className="border-pastypink bg-pastypink text-white hover:bg-pastypink/90"
    >
      Bookmarked
    </Button>
  </div>
);
