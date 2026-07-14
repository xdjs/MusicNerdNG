import { PleaseLoginPage } from "musicnerdweb";

/**
 * The gate shown in place of any authenticated route. It is deliberately spare: a centered
 * `text-2xl` bold heading and one `pastypink` Button whose click proxies to the real nav
 * login button (`#login-btn`). Wrapped in a bounded, page-like frame so the centering is
 * legible instead of collapsing to a bare stack of two elements.
 *
 * Note the button's hover is `hover:bg-gray-200` — a grey, not a pink tint. That is the
 * shipped styling (DESIGN.md flags it as an inconsistency); the preview shows it as-is.
 */
const Page = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-[220px] w-full max-w-md items-center justify-center rounded-xl border border-border bg-background">
    {children}
  </div>
);

/** Default copy — the generic route guard. */
export const Default = () => (
  <Page>
    <PleaseLoginPage />
  </Page>
);

/**
 * `text` is the only prop, and every real call site overrides it to name the thing being
 * gated (profile, bookmarks, the add-artist flow) rather than leaving the generic string.
 */
export const CustomCopy = () => (
  <Page>
    <PleaseLoginPage text="Log in to add an artist to MusicNerd" />
  </Page>
);
