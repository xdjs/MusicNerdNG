import { EditModeToggle } from "musicnerdweb";

/**
 * EditModeToggle reads `EditModeContext` and returns `null` unless `canEdit` is true —
 * so it only ever renders for whitelisted contributors and admins. The design-sync
 * provider stack already supplies `EditModeProvider canEdit`, which is why it appears
 * here at all.
 *
 * Resting state: an outline Button restyled with the brand token —
 * `border-pastypink/50 text-pastypink`, pencil icon, "Edit". The hover inversion
 * (solid pink fill, white text) does not fire in a static capture, so this shows the
 * resting state truthfully rather than faking it.
 */
export const Default = () => (
  <div className="flex items-center gap-2">
    <EditModeToggle />
  </div>
);

/**
 * Its real home: pinned to the right of an artist-page section heading, where it flips
 * the surrounding link grid between read and write. Shown at the same scale it appears
 * in the app — deliberately small, low-emphasis, and the only pink thing in the row.
 */
export const OnSectionHeader = () => (
  <div className="w-full max-w-md rounded-xl border border-border bg-card p-4">
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-bold uppercase tracking-wide text-maroon">
        Listen
      </h3>
      <EditModeToggle />
    </div>
    <ul className="space-y-1.5 text-sm text-muted-foreground">
      <li>Spotify · open.spotify.com/artist/2nvl0N9GwyX69RRBMEZ4OD</li>
      <li>Bandcamp · yaeji.bandcamp.com</li>
      <li>SoundCloud · soundcloud.com/yaeji</li>
    </ul>
  </div>
);
