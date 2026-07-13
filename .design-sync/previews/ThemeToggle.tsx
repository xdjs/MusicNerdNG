import { ThemeToggle } from "musicnerdweb";

/**
 * A hand-rolled pill switch — NOT a Radix Switch. It renders two buttons and lets the
 * `sm:` breakpoint pick one: a 48px circle below `sm`, and this 112×32 pill at and above
 * it. The knob is an absolutely-positioned 24px white circle that slides left↔right, and
 * the "Light Mode" / "Dark Mode" labels cross-fade on opacity so the pill never resizes.
 *
 * Previews capture light mode, so this is the resting light state: knob left, purple Sun,
 * "Light Mode" label pushed to the right edge (`justify-end pr-2`). The dark state swaps
 * to a `#2d3748` track, a black knob and a `pastyblue` Moon.
 */
export const Default = () => (
  <div className="flex items-center gap-4">
    <ThemeToggle />
  </div>
);

/**
 * Where it actually lives: far right of the nav bar, next to the wordmark and search.
 * Placed on a plain surface because the toggle carries its own `#f3f4f6` track — it has
 * no border, so it needs a lighter or darker surface behind it to read as a control.
 */
export const InNavBar = () => (
  <div className="flex w-full max-w-xl items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
    <span
      className="text-lg font-extrabold tracking-tight"
      style={{ color: "#ff9ce3" }}
    >
      MusicNerd
    </span>
    <div className="h-9 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
      Search artists…
    </div>
    <ThemeToggle />
  </div>
);
