import { Input, Label } from "musicnerdweb";

/**
 * THE MOST IMPORTANT FACT ABOUT THIS COMPONENT.
 *
 * `Input` was stripped of its chrome: the base class list has NO border, NO fixed height
 * (`h-10`), and NO focus ring — only `rounded-md bg-background px-3 py-2`. On a light
 * background it renders as an invisible rectangle. Stock shadcn ships
 * `h-10 border border-input focus-visible:ring-2`; all three were removed here.
 *
 * The left cell is the shipped default. The right cell is what every real form in the app
 * has to re-add by hand via className. That re-adding is the actual convention.
 */
export const BareVsStyled = () => (
  <div className="grid w-full max-w-xl gap-6 sm:grid-cols-2">
    <div className="space-y-2">
      <Label className="text-muted-foreground">Shipped default (no border)</Label>
      <Input placeholder="Search for an artist…" />
      <p className="text-xs text-muted-foreground">
        `&lt;Input /&gt;` with no className. There is a real input here.
      </p>
    </div>
    <div className="space-y-2">
      <Label>What call sites actually write</Label>
      <Input
        placeholder="Search for an artist…"
        className="h-10 rounded-md border border-input px-3 py-2"
      />
      <p className="text-xs text-muted-foreground">
        `h-10 rounded-md border border-input` bolted on at the call site.
      </p>
    </div>
  </div>
);

/**
 * The nav SearchBar composition: a leading Lucide magnifier absolutely positioned over a
 * `pl-10` Input. Ported from SearchBar.tsx, with the border added so the field is visible.
 */
export const WithLeadingIcon = () => (
  <div className="relative w-full max-w-[400px]">
    <Input
      type="text"
      placeholder="Search for an artist..."
      defaultValue="Arca"
      className="h-10 rounded-md border border-input pl-10 pr-3 py-2"
    />
    <svg
      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  </div>
);

/** The static states an Input can be captured in: empty, filled, disabled, read-only. */
export const States = () => {
  const chrome = "h-10 rounded-md border border-input px-3 py-2";
  return (
    <div className="grid w-full max-w-md gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="in-empty">Artist name</Label>
        <Input id="in-empty" placeholder="e.g. Yaeji" className={chrome} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-filled">Spotify URL</Label>
        <Input
          id="in-filled"
          defaultValue="https://open.spotify.com/artist/2VZNmg3v9nbVMnRkZadyi5"
          className={chrome}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-disabled">Wallet address</Label>
        <Input
          id="in-disabled"
          disabled
          defaultValue="0x4a1e…9c02 (linked via Privy)"
          className={chrome}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="in-invalid">Bandcamp URL</Label>
        <Input
          id="in-invalid"
          defaultValue="bandcamp/notarealartist"
          aria-invalid
          className="h-10 rounded-md border border-destructive px-3 py-2"
        />
        <p className="text-sm font-medium text-destructive">
          Doesn&apos;t match the Bandcamp URL pattern in urlmap.
        </p>
      </div>
    </div>
  );
};

/**
 * The `glass-subtle` wrapper pattern from AddArtistData: the Input keeps its borderless
 * default and the surrounding glass pill supplies the chrome. This is the one place the
 * stripped-bare default is actually load-bearing rather than a bug.
 *
 * `.glass-subtle` is a translucent white — it needs a saturated backdrop to be visible at
 * all, so the card sits on the brand gradient the artist page uses.
 */
export const GlassWrapper = () => (
  <div className="w-full rounded-xl bg-gradient-to-br from-pastypink via-[#7c3aed] to-pastyblue p-8">
    <div className="flex max-w-md gap-2">
      <div className="glass-subtle flex h-11 flex-grow items-center rounded-lg px-3">
        <Input
          placeholder="Paste a profile link…"
          defaultValue="https://soundcloud.com/jamie-xx"
          className="w-full border-0 bg-transparent p-0 text-sm text-black outline-none placeholder:text-muted-foreground"
        />
      </div>
      <button
        type="button"
        className="h-11 shrink-0 rounded-lg bg-pastypink px-4 text-sm font-medium text-white"
      >
        Submit
      </button>
    </div>
  </div>
);
