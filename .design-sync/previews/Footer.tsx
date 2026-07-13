import { Footer } from "musicnerdweb";

/**
 * The whole component is one line of copy — "Made in Seattle by @cxy @clt and friends" —
 * in `text-maroon`, bold, `text-[14px]` on mobile stepping up to `text-[25px]` at `sm`.
 * The handles are underlined anchors. There is no border, no background, no nav: the
 * footer is intentionally a signature, not a sitemap.
 *
 * It ships `mt-auto`, which only does anything inside a flex column — so the wrapper here
 * is a min-height flex column that pins it to the bottom, exactly as `layout.tsx` does.
 * Without that wrapper the `mt-auto` is a no-op and the component reads as floating text.
 */
export const Default = () => (
  <div className="flex h-[220px] w-full max-w-2xl flex-col rounded-xl border border-border bg-background">
    <div className="flex-1 px-6 py-6">
      <p className="text-sm text-muted-foreground">
        …end of the artist grid. Page content ends here; the footer is pushed to the
        bottom of the viewport by <code className="text-foreground">mt-auto</code>.
      </p>
    </div>
    <Footer />
  </div>
);
