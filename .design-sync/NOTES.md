# design-sync notes — MusicNerdWeb

Repo-specific gotchas for future syncs. Read this before re-running the converter.

## The big one: this is an app, not a component library

There is no `dist/`, no published package, no `.d.ts` tree. Three consequences drive most of the
config:

- **`.design-sync/ds-entry.ts` IS the library boundary.** It is hand-written and committed, and the
  converter runs with `--entry ./.design-sync/ds-entry.ts`. Do NOT let the converter synthesize an
  entry from `src/` — a synth entry does `export * from` every source file, which drags the async
  server components (`ArtistLinks`, `ArtistLinksGrid`) and through them Drizzle/postgres/next-auth
  into a browser bundle.
- **`componentSrcMap` IS the component list**, not a set of tweaks to a discovered one. Anything you
  add to `ds-entry.ts` must also be added there or it ships in the bundle without getting a card.
- **Never `ln -s` the repo into `node_modules/musicnerdweb`.** It looks like the obvious way to make
  the converter's `PKG_DIR` resolve, but it creates a symlink cycle
  (`node_modules/musicnerdweb/node_modules/musicnerdweb/…`) that OOM'd the v8 heap during the
  ts-morph glob. `--entry` is what makes `PKG_DIR` resolve; no symlink needed.

## Tailwind must be COMPILED before the converter runs

`src/app/globals.css` is raw `@tailwind` directives. Pointing `cssEntry` at it ships a stylesheet
with no utilities in it and every component renders unstyled. `cfg.buildCmd` compiles
`.design-sync/tailwind.ds.config.ts` → `.design-sync/.cache/ds-tailwind.css` first. **Re-run
`buildCmd` before every converter run.**

`tailwind.ds.config.ts` extends the app's real config (never redefines design values) and adds:
1. content globs covering `.design-sync/previews/**` so authored-preview classes compile;
2. a **safelist** of the general utility surface.

The safelist is not optional. A rendered design receives only `styles.css` — there is no Tailwind
JIT at the other end — so any class the design agent writes that isn't already in the sheet is
silently dead. Curating the palette (brand + shadcn semantic + the ~20 hues the app actually uses,
rather than all 22 Tailwind hues) is what keeps this at ~7MB / 464KB gzipped instead of 29MB.
If you widen the safelist, re-check the size.

## Two forked lib adapters (`.design-sync/overrides/`)

Both exist because the upstream converter assumes `pkgDir == node_modules/<pkg>`, which is false here.

- **`dts.mjs`** — props are extracted from the `.tsx` SOURCES, not a `.d.ts` tree. Without it every
  contract was `{ [key: string]: unknown }` (the agent would never learn `Button` has `variant`).
  Also bounds the ts-morph glob to `src/` (the repo-root glob walked `.next/`, 2.4GB, and OOM'd) and
  drops props declared in `next/dist/compiled/` — Next's vendored satori injects a global
  `tw?: string` JSX prop into every element, documented as "Specify styles using Tailwind CSS
  classes", which would invite the agent to write `tw=` instead of `className=`. The node_modules
  filter is deliberately scoped to that one path: Radix declares real API under node_modules
  (`Dialog.open`, `Checkbox.checked`) and must survive.
- **`source-kit.mjs`** — Next's App Router `_components` private-folder prefix and the `app/` router
  root aren't in the generic-dir set, so brand components were forced into a group literally named
  "components", which then OUTRANKED the `category:` frontmatter and made the regroup stubs no-ops.
  Also seeds the component list from `componentSrcMap` (see above).

`.design-sync/node_modules` is a gitignored symlink → `.ds-sync/node_modules`, needed so the forks
can resolve their bare `ts-morph` import. **Recreate it on a fresh clone:**
`ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`

## Component-set decisions

- **`HomePageSplash` is deliberately NOT synced.** It mounts `ActivityFeed`, which imports
  `next/link`, whose module scope reads `process.env.__NEXT_*` — Next-compiler-substituted globals
  that don't exist in a plain browser bundle. That was a hard `ReferenceError: process is not
  defined` at IIFE init which took down **all 28 components**, not just this one. ActivityFeed also
  fetches `/api/activity`, which no design runtime can serve. The wordmark is documented as a
  copyable recipe in `conventions.md` instead. **If you ever re-add it, check for `process.env` in
  `_ds_bundle.js` — a single Next import re-breaks the whole bundle.**
- **Sub-parts get no cards.** `ds-entry.ts` exports ~109 symbols; only 28 get cards. `CardHeader`,
  `DialogFooter`, `SelectItem` etc. all still ship and are importable — they just don't each get a
  duplicate preview and a near-empty contract. Each compound's authored preview demonstrates its
  sub-parts in a real composition instead.
- Excluded as unrenderable (DB/session/fetch-bound): `ArtistLinks`, `ArtistLinksGrid`,
  `EditablePlatformLink`, `EditableLinkIcon`, `ActivityFeed`, `Providers`, `PrivyProviderWrapper`,
  `nav/*`. `ArtistLinksGrid`'s glass-tile look is brand-defining, so it's captured as a documented
  pattern in `conventions.md` rather than shipped as a component that can't render.

## Authoring previews — what was learned the hard way

- Import from `"musicnerdweb"` (shimmed to `window.MusicNerd`). `@/` aliases resolve too.
- **Overlays portal to `document.body` and are viewport-`fixed`** (Dialog, Drawer, DropdownMenu,
  Popover, Tooltip, Select, Toast). They escape their cell and get clipped. Fix with
  `cfg.overrides.<Name> = {cardMode:"single", primaryStory:"…", viewport:"WxH"}`.
  **Do NOT pass `className="relative"` to fight it** — `cn()` is tailwind-merge, so `relative`
  *replaces* `fixed`, and the `-translate-50%` then yanks the content off the top edge. It renders
  worse, not better. Pass `open` (and `modal={false}` to avoid inert/scroll-lock).
- **`.glass` is invisible on white.** It's `rgba(255,255,255,0.55)` + a white border. It only reads
  over color. Any preview showing a glass surface needs a saturated backdrop — the app always has
  one (hero gradient, artist photography).
- **`Input` ships with no border, no height, and no focus ring** (DESIGN.md #10 — it's stripped
  bare). A bare `<Input/>` renders as an invisible blank and trips `[RENDER_BLANK]`. Form previews
  must add `h-10 rounded-md border border-input px-3 py-2` — which is what every real form in the
  app does. Same story for `Textarea`'s missing ring width (#11).
- Use MusicNerd-real content (artists, platforms, contributors, MCP keys) — never foo/bar.

## Findings from the preview-authoring wave

Two claims came back from the parallel agents that were WRONG. Both are recorded here because they
are exactly the mistakes a future run would repeat.

- **"`bg-primary` is brand pink."** It is NOT. `--primary` is stock slate navy
  (`222.2 47.4% 11.2%`) and the default Button renders navy. What the agent actually saw was
  `globals.css:485` — an **unscoped** `[data-state="checked"] { background-color: #ff9ce3
  !important }`. That selector isn't limited to Checkbox: it hits ANY Radix element in the checked
  state, so a selected `SelectItem` and a checked `DropdownMenuCheckboxItem` also go pink. It is the
  one place brand color reaches the primitives without a call-site class.
- **"`text-[#ff9ce3]` renders black / arbitrary utilities don't apply."** They DO. Verified by
  computed style in headless chromium: `text-[#ff9ce3]` → `rgb(255, 156, 227)`. The agent observed
  truthfully but the cause was a moving stylesheet — the orchestrator recompiled and swapped
  `_ds_bundle.css` **mid-wave**, so early captures ran against a sheet that genuinely lacked the
  class. **Lesson: never swap the shared stylesheet while agents are capturing.** Recompile before
  dispatch, or after the wave — never during.

Real findings worth keeping:

- **`.home-text-h2` is a colour trap, not a type class.** It looks like pure fluid-type
  (font-size/letter-spacing clamps) but `globals.css:186-260` also pins `color: … !important`
  (`:first-child` → `#ff9ce3`, otherwise → `#9b83a0`), silently overriding any `text-*` utility on
  it. Don't use it for hero markup.
- **`TableCell`'s truncation is conditional.** `whitespace-nowrap overflow-hidden text-ellipsis` on
  a `<td>` does nothing under the default `table-layout: auto` (the wrapper scrolls instead). It
  only ellipsizes under `table-fixed`, which `UserEntriesTable` never sets.
- **`Checkbox` indeterminate is genuinely broken.** The Indicator renders for both `checked` and
  `indeterminate`, but the fill is gated on `data-[state=checked]` only — so indeterminate paints a
  checkmark on an *unfilled* square. Stock shadcn shows a dash. The admin select-all header hits
  this on every partial page selection. A real fix candidate in the app.
- **`LoadingPage` is `fixed inset-0 z-[9999]`** — it blankets anything it's dropped into unless an
  ancestor establishes a containing block (an inline `transform` does it).
- **The capture server can't serve SVG.** `.ds-sync/storybook/http-serve.mjs`'s MIME table has no
  `.svg`, and it doesn't serve Next's `public/`. `previews/LoadingPage.tsx` inlines the real
  `public/spinner.svg` as a data URI to work around it (the shipped asset, not a substitute).
- **The safelist had real gaps** the app's own source never exercised: `basis-*` (Carousel slides
  collapsed without it), `table-fixed`, and arbitrary gradient stops. Added. Expect more gaps in
  this shape — the design agent writes classes the app never did.
- `react-hook-form` resolves inside previews, and hooks run during capture — so validation error
  states can be injected with `form.setError` in a `useEffect` (no submit needed).
- A preview cell whose only axis is a sub-30% opacity delta will not read on a downscaled review
  sheet. Pair it with a full-strength baseline.

## Known render warns (expected — not new findings)

Check new warns against this list; anything not here is genuinely new.

- `[FONT_MISSING] "KoHo"` — **expected, and correct.** KoHo is declared in `globals.css`
  (`.koho-extralight`, `.koho-light`, `.pink-btn`) but is loaded NOWHERE in the app: no `next/font`,
  no `<link>`, no `@font-face`. It silently falls back to system sans in production today (DESIGN.md
  headline typography finding; design-debt #7 is still open). **The user explicitly chose to match
  production and NOT ship KoHo** — shipping it would make every design render in a typeface the real
  site doesn't have. The warn is a truthful signal; leave it firing.
- `[FONT_MISSING] "Cambria"` — false alarm. It's just a member of Tailwind's default `font-serif`
  fallback stack (`ui-serif, Georgia, Cambria, …`). No `@font-face` is wanted.
- `[TOKENS_MISSING]` (9 vars) — all set at runtime, never by a stylesheet:
  `--radix-accordion-content-height` (Radix measures it), `--tw-shadow-color` (Tailwind internal),
  `--scrollbar-*` (the `tailwind-scrollbar` plugin emits them per-utility).
- `[RENDER_BLANK]` on a bare `Input`/`Textarea`/`Checkbox` floor card — a true statement about a
  borderless primitive, resolved by authoring the preview (see above).

## Re-sync risks

- **`buildCmd` (the Tailwind compile) is a hard prerequisite.** Skip it and `cssEntry` points at a
  stale or missing file. The driver does not know to run it for you.
- **The safelist can silently rot.** It's a hand-maintained approximation of "what the design agent
  might write". If the app adopts a new hue or a plugin, add it — a missing class doesn't error, it
  just renders unstyled.
- **The two lib forks are pinned to upstream internals** (`projectFor`, `isOwnProp`, the group
  derivation, the component-list seed). On re-sync, diff them against `.ds-sync/lib/*.mjs` and merge
  upstream changes; if the converter's shape changed, the forks may need rework rather than a merge.
- **`.next/` size is load-bearing for build time.** The dts fork bounds its glob to `src/`, so a big
  `.next/` is fine now — but any change that re-widens a glob to the repo root will OOM again.
- `HomePageSplash`/`ActivityFeed` are the tripwire for Next imports leaking into the bundle. Grep
  `_ds_bundle.js` for `process.env` after any change to `ds-entry.ts`.
