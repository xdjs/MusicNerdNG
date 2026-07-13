import { Label, Textarea } from "musicnerdweb";

/**
 * The shipped default. Two deliberate-looking deviations from stock shadcn are visible here:
 *
 * 1. `min-h-[50px]` instead of stock `min-h-[80px]` — the empty field is noticeably squatter
 *    than a shadcn Textarea anywhere else.
 * 2. The focus ring is BROKEN: the class list has `focus-visible:ring-ring` and
 *    `focus-visible:ring-offset-2` but no `focus-visible:ring-2`, so ring width stays 0 and
 *    nothing paints on focus. Unlike Input, the border IS present.
 */
export const Default = () => (
  <div className="w-full max-w-md space-y-1.5">
    <Label htmlFor="ta-default">Artist bio</Label>
    <Textarea
      id="ta-default"
      placeholder="Tell us about this artist…"
    />
    <p className="text-sm text-muted-foreground">
      Empty height is 50px — stock shadcn is 80px.
    </p>
  </div>
);

/**
 * Realistic content at the height an editor actually uses. The AI-bio review surface passes
 * `rows` / a min-height override rather than living with the 50px default.
 */
export const Filled = () => (
  <div className="w-full max-w-lg space-y-1.5">
    <Label htmlFor="ta-bio">AI-generated bio (editable before publish)</Label>
    <Textarea
      id="ta-bio"
      rows={6}
      className="min-h-[140px]"
      defaultValue={
        "Yaeji is a Korean-American producer and vocalist whose work folds house, hip-hop and Korean-language pop into something quietly euphoric. Since 'Raingurl' broke out in 2017 she has released on Godmode and XL Recordings, and her 2023 album 'With A Hammer' pushed further into live instrumentation."
      }
    />
    <p className="text-sm text-muted-foreground">
      Regenerated automatically whenever a platform link changes.
    </p>
  </div>
);

/** The two non-default static states: disabled and error. */
export const States = () => (
  <div className="grid w-full max-w-lg gap-5">
    <div className="space-y-1.5">
      <Label htmlFor="ta-disabled">Fun fact (regenerating…)</Label>
      <Textarea
        id="ta-disabled"
        disabled
        className="min-h-[70px]"
        defaultValue="Arca scored the runway music for Björk's Cornucopia tour."
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="ta-error" className="text-destructive">
        Moderation note
      </Label>
      <Textarea
        id="ta-error"
        aria-invalid
        className="min-h-[70px] border-destructive"
        defaultValue="dupe"
      />
      <p className="text-sm font-medium text-destructive">
        Rejection notes must be at least 20 characters — reviewers see this text.
      </p>
    </div>
  </div>
);
