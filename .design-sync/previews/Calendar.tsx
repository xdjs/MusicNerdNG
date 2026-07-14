import { Calendar } from "musicnerdweb";

/**
 * Single-month, single-day select — the base shape. Every day cell is a ghost Button
 * (`buttonVariants({ variant: "ghost" })` at h-9 w-9), so the calendar inherits the
 * button system rather than defining its own hit targets. The selected day flips to
 * `bg-primary text-primary-foreground`; today gets `bg-accent`.
 */
export const Default = () => (
  <Calendar
    mode="single"
    defaultMonth={new Date(2026, 6, 1)}
    selected={new Date(2026, 6, 9)}
    className="rounded-lg border bg-card"
  />
);

/**
 * The real in-app usage: the profile leaderboard date-range filter
 * (`src/app/profile/DatePicker.tsx` — `mode="range"`, `numberOfMonths={2}`), which
 * normally lives inside a Popover. Range middles are `bg-accent`, the two endpoints are
 * `bg-primary`, and `showOutsideDays` leaves the neighbouring month's days visible in
 * muted-foreground.
 */
export const ContributionRange = () => (
  <Calendar
    mode="range"
    numberOfMonths={2}
    defaultMonth={new Date(2026, 5, 1)}
    selected={{ from: new Date(2026, 5, 14), to: new Date(2026, 6, 2) }}
    className="rounded-lg border bg-card"
  />
);

/**
 * Disabled days — future dates can't be filtered on, since no submissions exist yet.
 * `day_disabled` is `text-muted-foreground opacity-50`, which is a *very* light touch:
 * on white it reads only barely differently from an outside-month day. Worth knowing
 * before relying on it as the sole affordance.
 */
export const WithDisabledDays = () => (
  <Calendar
    mode="single"
    defaultMonth={new Date(2026, 6, 1)}
    selected={new Date(2026, 6, 6)}
    disabled={{ after: new Date(2026, 6, 13) }}
    className="rounded-lg border bg-card"
  />
);
