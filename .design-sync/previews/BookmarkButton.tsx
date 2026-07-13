import { BookmarkButton } from "musicnerdweb";

/**
 * BookmarkButton is localStorage-backed: it reads `bookmarks_<userId>` on mount and
 * derives its own `bookmarked` state from it. There is no controlled prop, so the only
 * honest way to show the *filled* state is to seed the store the component actually reads.
 * Two distinct userIds keep the two cells independent.
 */
const SEEDED_USER = "user-seeded-bookmarks";
const EMPTY_USER = "user-no-bookmarks";

if (typeof window !== "undefined") {
  window.localStorage.setItem(
    `bookmarks_${SEEDED_USER}`,
    JSON.stringify([{ artistId: "artist-arca", artistName: "Arca" }]),
  );
  window.localStorage.removeItem(`bookmarks_${EMPTY_USER}`);
}

/**
 * The two states side by side. Un-bookmarked is a white pill with a `pastypink` 2px border
 * and pink label + icon; bookmarked inverts to a solid `pastypink` fill with white content.
 * Both are locked to `w-[120px]` so the label swap ("Bookmark" → "Bookmarked") never
 * reflows the row it sits in — that fixed width is the whole reason the component exists
 * as a wrapper instead of a bare Button.
 */
export const States = () => (
  <div className="flex flex-wrap items-center gap-3">
    <BookmarkButton
      userId={EMPTY_USER}
      artistId="artist-jpegmafia"
      artistName="JPEGMAFIA"
    />
    <BookmarkButton
      userId={SEEDED_USER}
      artistId="artist-arca"
      artistName="Arca"
    />
  </div>
);

/**
 * In the app this button sits on the artist header, to the right of the name and next to
 * the other row actions. The fixed 120px width plus `flex-shrink-0` is what stops it from
 * being squeezed by a long artist name.
 */
export const OnArtistHeader = () => (
  <div className="w-full max-w-md rounded-xl border border-border bg-card p-4">
    <div className="flex items-center gap-3">
      <div className="h-14 w-14 flex-shrink-0 rounded-full bg-gradient-to-br from-pastypink to-pastyblue" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-bold text-maroon">
          Yaeji
        </div>
        <div className="truncate text-sm text-muted-foreground">
          house · korean-american · added by @cxy
        </div>
      </div>
      <BookmarkButton
        userId={SEEDED_USER}
        artistId="artist-arca"
        artistName="Yaeji"
      />
    </div>
  </div>
);
