import { TypeWriter } from "musicnerdweb";

/**
 * Types `text` out one character at a time. Two timers gate it: `startDelay` (default
 * 1000ms) before the first character, then `typingDelay` (default 80ms) per character.
 *
 * Three things a preview author must know:
 *  1. At the shipped defaults a static capture lands INSIDE the 1000ms start delay and
 *     photographs an empty string. Both cells below collapse `startDelay` to 0 and
 *     `typingDelay` to 1ms so the capture catches the settled, fully-typed frame — which
 *     is the frame a user spends ~all of their time looking at anyway.
 *  2. It accepts a `className` prop and then never applies it — the render is a bare
 *     `<span>{displayText}</span>`. So ALL typography must come from the PARENT element.
 *     That is not a workaround; it is the only way to style this component today.
 *  3. Do not reach for the `.home-text-h2` global to typeset it: that class also carries
 *     `color: … !important` in globals.css and will hijack whatever colour you set.
 */

/** The settled frame at hero scale, with the parent supplying size, weight and colour. */
export const HeroHeadline = () => (
  <div className="w-full max-w-xl rounded-xl border border-border bg-card px-6 py-6">
    <h2 className="text-4xl font-bold text-maroon">
      <TypeWriter text="who made this?" startDelay={0} typingDelay={1} />
    </h2>
  </div>
);

/**
 * Inline inside body copy, with the parent supplying the brand pink users actually SEE —
 * `#ff9ce3`, a raw literal that lives in no palette (wordmark, highlight glows). It is
 * applied by inline style, exactly as the app applies it. A blinking caret is composed
 * alongside, since the component ships none of its own.
 */
export const InlineAccent = () => (
  <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-6">
    <p className="text-lg text-muted-foreground">
      Now indexing{" "}
      <span className="font-bold" style={{ color: "#ff9ce3" }}>
        <TypeWriter text="Sudan Archives" startDelay={0} typingDelay={1} />
        <span
          className="ml-0.5 inline-block h-4 w-0.5 align-middle"
          style={{ backgroundColor: "#ff9ce3" }}
        />
      </span>{" "}
      across 40+ platforms.
    </p>
  </div>
);
