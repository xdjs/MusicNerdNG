import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "musicnerdweb";

/**
 * Toast needs ToastProvider + ToastViewport (the viewport is itself `fixed`), and each Toast
 * must be forced `open` — nothing renders otherwise. ToastClose is `opacity-0` until
 * group-hover, which never fires in a headless capture, so `opacity-100` is passed to make the
 * dismiss affordance visible. The capture also takes no animation settle, so
 * `animation: none` pins the toast at its resting position instead of mid `slide-in`.
 *
 * The wrapper + `absolute` viewport is a HARNESS workaround, not a DS pattern: the card's
 * `.ds-single` root carries a `transform`, which makes it the containing block for anything
 * `position: fixed`. ToastViewport is rendered inline (Radix does not portal it), so its
 * `fixed bottom-0` resolved against that box and stranded the toast at the frame edge in a sea
 * of whitespace. Merging `absolute` over its `fixed` (ToastViewport uses cn()/tailwind-merge)
 * anchors it inside a bounded relative box. The toast's own appearance is untouched.
 *
 * Copy comes from EditablePlatformLink.tsx ("<Platform> link has been removed") and the
 * admin claims table.
 */
export const Default = () => (
  <div className="relative h-40 w-full">
    <ToastProvider duration={Infinity}>
    <Toast open style={{ animation: "none" }}>
      <div className="grid gap-1">
        <ToastTitle>Spotify link has been removed</ToastTitle>
        <ToastDescription>
          The change is live on Four Tet&apos;s profile.
        </ToastDescription>
      </div>
      <ToastAction altText="Undo removing the Spotify link">Undo</ToastAction>
      <ToastClose className="opacity-100" />
    </Toast>
      <ToastViewport className="absolute inset-x-0 top-0 max-w-full p-3" />
    </ToastProvider>
  </div>
);

/**
 * The destructive variant, as fired by SearchBar.tsx when adding an artist fails.
 */
export const Destructive = () => (
  <div className="relative h-40 w-full">
    <ToastProvider duration={Infinity}>
    <Toast open variant="destructive" style={{ animation: "none" }}>
      <div className="grid gap-1">
        <ToastTitle>Error</ToastTitle>
        <ToastDescription>
          Failed to add artist — please try again.
        </ToastDescription>
      </div>
      <ToastAction altText="Retry adding the artist">Retry</ToastAction>
      <ToastClose className="opacity-100" />
    </Toast>
      <ToastViewport className="absolute inset-x-0 top-0 max-w-full p-3" />
    </ToastProvider>
  </div>
);

/**
 * Title-only toast (no description, no action) — the shape most `toast({ title })` calls in the
 * repo actually produce, e.g. the admin claims table's `Claim Approved`.
 */
export const TitleOnly = () => (
  <div className="relative h-40 w-full">
    <ToastProvider duration={Infinity}>
    <Toast open style={{ animation: "none" }}>
      <div className="grid gap-1">
        <ToastTitle>Claim approved</ToastTitle>
      </div>
      <ToastClose className="opacity-100" />
    </Toast>
      <ToastViewport className="absolute inset-x-0 top-0 max-w-full p-3" />
    </ToastProvider>
  </div>
);
