import { useEffect, useRef } from "react";
import { LoadingPage } from "musicnerdweb";

/**
 * Two capture-harness facts drive this file:
 *
 * 1. LoadingPage is a `fixed inset-0 z-[9999]` full-viewport scrim. Dropped straight into a
 *    preview grid it blankets the whole sheet. The wrapper below carries an inline
 *    `transform: translateZ(0)`, which makes it the containing block for `position: fixed`
 *    descendants, bounding the overlay to this card. (Inline style, not a Tailwind arbitrary
 *    property — the DS stylesheet does not emit those.)
 *
 * 2. The spinner is `<img src="/spinner.svg">`. The preview server serves only the bundle dir
 *    and its MIME table has no `.svg` entry, so the request 404s / mis-types and the browser
 *    paints a broken-image glyph. `useRealSpinner` re-points that exact <img> at the REAL
 *    public/spinner.svg, inlined as a data URI — so the card shows the shipped asset, not a
 *    substitute. Remove this shim once the harness serves public/ with an svg MIME type.
 */
const SPINNER_DATA_URI = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiBzdHlsZT0ibWFyZ2luOiBhdXRvOyBiYWNrZ3JvdW5kOiBub25lOyBkaXNwbGF5OiBibG9jazsgc2hhcGUtcmVuZGVyaW5nOiBhdXRvOyIgd2lkdGg9IjIwMHB4IiBoZWlnaHQ9IjIwMHB4IiB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgcHJlc2VydmVBc3BlY3RSYXRpbz0ieE1pZFlNaWQiPgo8ZyB0cmFuc2Zvcm09InJvdGF0ZSgwIDUwIDUwKSI+CiAgPHJlY3QgeD0iMjkuNSIgeT0iOS41IiByeD0iMjAuNSIgcnk9IjIwLjUiIHdpZHRoPSI0MSIgaGVpZ2h0PSI0MSIgZmlsbD0iI2ZmOWFlMSI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJvcGFjaXR5IiB2YWx1ZXM9IjE7MCIga2V5VGltZXM9IjA7MSIgZHVyPSIwLjYyNXMiIGJlZ2luPSItMC41NDY4NzVzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSI+PC9hbmltYXRlPgogIDwvcmVjdD4KPC9nPjxnIHRyYW5zZm9ybT0icm90YXRlKDQ1IDUwIDUwKSI+CiAgPHJlY3QgeD0iMjkuNSIgeT0iOS41IiByeD0iMjAuNSIgcnk9IjIwLjUiIHdpZHRoPSI0MSIgaGVpZ2h0PSI0MSIgZmlsbD0iI2ZmOWFlMSI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJvcGFjaXR5IiB2YWx1ZXM9IjE7MCIga2V5VGltZXM9IjA7MSIgZHVyPSIwLjYyNXMiIGJlZ2luPSItMC40Njg3NXMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIj48L2FuaW1hdGU+CiAgPC9yZWN0Pgo8L2c+PGcgdHJhbnNmb3JtPSJyb3RhdGUoOTAgNTAgNTApIj4KICA8cmVjdCB4PSIyOS41IiB5PSI5LjUiIHJ4PSIyMC41IiByeT0iMjAuNSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjQxIiBmaWxsPSIjZmY5YWUxIj4KICAgIDxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9Im9wYWNpdHkiIHZhbHVlcz0iMTswIiBrZXlUaW1lcz0iMDsxIiBkdXI9IjAuNjI1cyIgYmVnaW49Ii0wLjM5MDYyNXMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIj48L2FuaW1hdGU+CiAgPC9yZWN0Pgo8L2c+PGcgdHJhbnNmb3JtPSJyb3RhdGUoMTM1IDUwIDUwKSI+CiAgPHJlY3QgeD0iMjkuNSIgeT0iOS41IiByeD0iMjAuNSIgcnk9IjIwLjUiIHdpZHRoPSI0MSIgaGVpZ2h0PSI0MSIgZmlsbD0iI2ZmOWFlMSI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJvcGFjaXR5IiB2YWx1ZXM9IjE7MCIga2V5VGltZXM9IjA7MSIgZHVyPSIwLjYyNXMiIGJlZ2luPSItMC4zMTI1cyIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiPjwvYW5pbWF0ZT4KICA8L3JlY3Q+CjwvZz48ZyB0cmFuc2Zvcm09InJvdGF0ZSgxODAgNTAgNTApIj4KICA8cmVjdCB4PSIyOS41IiB5PSI5LjUiIHJ4PSIyMC41IiByeT0iMjAuNSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjQxIiBmaWxsPSIjZmY5YWUxIj4KICAgIDxhbmltYXRlIGF0dHJpYnV0ZU5hbWU9Im9wYWNpdHkiIHZhbHVlcz0iMTswIiBrZXlUaW1lcz0iMDsxIiBkdXI9IjAuNjI1cyIgYmVnaW49Ii0wLjIzNDM3NXMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIj48L2FuaW1hdGU+CiAgPC9yZWN0Pgo8L2c+PGcgdHJhbnNmb3JtPSJyb3RhdGUoMjI1IDUwIDUwKSI+CiAgPHJlY3QgeD0iMjkuNSIgeT0iOS41IiByeD0iMjAuNSIgcnk9IjIwLjUiIHdpZHRoPSI0MSIgaGVpZ2h0PSI0MSIgZmlsbD0iI2ZmOWFlMSI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJvcGFjaXR5IiB2YWx1ZXM9IjE7MCIga2V5VGltZXM9IjA7MSIgZHVyPSIwLjYyNXMiIGJlZ2luPSItMC4xNTYyNXMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIj48L2FuaW1hdGU+CiAgPC9yZWN0Pgo8L2c+PGcgdHJhbnNmb3JtPSJyb3RhdGUoMjcwIDUwIDUwKSI+CiAgPHJlY3QgeD0iMjkuNSIgeT0iOS41IiByeD0iMjAuNSIgcnk9IjIwLjUiIHdpZHRoPSI0MSIgaGVpZ2h0PSI0MSIgZmlsbD0iI2ZmOWFlMSI+CiAgICA8YW5pbWF0ZSBhdHRyaWJ1dGVOYW1lPSJvcGFjaXR5IiB2YWx1ZXM9IjE7MCIga2V5VGltZXM9IjA7MSIgZHVyPSIwLjYyNXMiIGJlZ2luPSItMC4wNzgxMjVzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSI+PC9hbmltYXRlPgogIDwvcmVjdD4KPC9nPjxnIHRyYW5zZm9ybT0icm90YXRlKDMxNSA1MCA1MCkiPgogIDxyZWN0IHg9IjI5LjUiIHk9IjkuNSIgcng9IjIwLjUiIHJ5PSIyMC41IiB3aWR0aD0iNDEiIGhlaWdodD0iNDEiIGZpbGw9IiNmZjlhZTEiPgogICAgPGFuaW1hdGUgYXR0cmlidXRlTmFtZT0ib3BhY2l0eSIgdmFsdWVzPSIxOzAiIGtleVRpbWVzPSIwOzEiIGR1cj0iMC42MjVzIiBiZWdpbj0iMHMiIHJlcGVhdENvdW50PSJpbmRlZmluaXRlIj48L2FuaW1hdGU+CiAgPC9yZWN0Pgo8L2c+CjwhLS0gW2xkaW9dIGdlbmVyYXRlZCBieSBodHRwczovL2xvYWRpbmcuaW8vIC0tPjwvc3ZnPg==";

function useRealSpinner(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const img = ref.current?.querySelector<HTMLImageElement>('img[alt="Loading"]');
    if (img) img.src = SPINNER_DATA_URI;
  });
}

const Frame = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useRealSpinner(ref as React.RefObject<HTMLDivElement>);
  return (
    <div
      ref={ref}
      className="relative h-64 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card"
      style={{ transform: "translateZ(0)" }}
    >
      {/* Real page content, so the scrim has something to veil. On a blank white card the
          bg-white/80 + backdrop-blur-sm treatment would be completely invisible. */}
      <div className="space-y-3 p-5">
        <div className="text-xl font-bold text-maroon">Sudan Archives</div>
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-5/6 rounded bg-muted" />
        <div className="h-28 w-full rounded-lg bg-gradient-to-br from-pastypink via-purple-600 to-pastyblue" />
      </div>
      {children}
    </div>
  );
};

/**
 * Default state: an 80%-white blurred scrim over the page, with a white `rounded-xl shadow-lg`
 * card holding the 48px spinner and the message. It also locks `body` scroll while mounted.
 */
export const Default = () => (
  <Frame>
    <LoadingPage />
  </Frame>
);

/**
 * `message` is the only prop. Call sites use it to name the operation being awaited — the
 * add-artist flow names the artist being written, so the wait is attributable rather than generic.
 */
export const WithMessage = () => (
  <Frame>
    <LoadingPage message="Adding Yaeji…" />
  </Frame>
);
