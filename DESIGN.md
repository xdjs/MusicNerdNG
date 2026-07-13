# MusicNerdWeb — Design System (DESIGN.md)

## Purpose & how to use this doc

This file is the **north star** for MusicNerdWeb's visual and interaction design. It is the single source of truth for color, typography, layout, components, and motion.

Two rules for using it:

1. **It documents what EXISTS today**, grounded in the actual code — not an aspirational redesign. Where a value is a stock shadcn/Tailwind default that was never rebranded, this doc **flags it as stock** so it can be changed *on purpose* rather than by accident.
2. **When proposing any UI change, state it against this system.** Say which token/utility/component you are touching, whether you are following an existing convention or introducing a new one, and — if you are diverging — why. Prefer editing tokens over adding one-off hex literals.

A companion section, [Known inconsistencies to reconcile](#known-inconsistencies-to-reconcile), catalogs where the current implementation contradicts itself. Treat that table as the backlog of design-debt decisions: each row is a place where a human should pick one source of truth.

> **The single most important fact about this codebase:** the brand identity (candy-neon pink/blue/green over frosted glass) is applied *on top of* an **unmodified shadcn "slate" token layer**, almost entirely through hardcoded hex literals and a ~330-line wall of `!important` dark-mode overrides — not through the semantic token system. `--primary` is navy slate; the brand's pink lives outside the tokens as three different hex values. Nearly every inconsistency below traces back to this.

---

## Design philosophy

MusicNerd is a **playful, indie, candy-neon music directory dressed in Apple-style frosted glass.** The personality lives in a handful of electric accent colors — a hot orchid pink, a bright cyan, and a jelly mint-green — set against a light-forward, rounded, glassmorphic surface language, with a lowercase-casual voice ("music nerd", "Made in Seattle by @cxy @clt and friends"). Underneath, the structural chrome (buttons, cards, inputs, semantic tokens) is stock shadcn slate — brand character is layered on top as ad-hoc hex accents and glass utilities.

**Signature visual moves:**

- **The neon accent trio** — `pastyblue #2ad4fc`, `pastypink #ef95ff`, `jellygreen #19ffb8`. The whimsical names ("pasty", "jelly") are themselves a voice cue. `maroon #422b46` is the deep-aubergine "ink" for footer/body text.
- **The glowing hot-pink wordmark** — the homepage renders only a giant lowercase `music nerd` in `#ff9ce3` with a pink `textShadow` glow, fluid-sized `clamp(32px → 84px)` with tight negative letter-spacing.
- **Apple-style glassmorphism panels** — `.glass` (translucent white + `backdrop-filter: blur(20px) saturate(180%)`) is the primary surface across 13+ artist-page components and admin. Even the scrollbar is themed to match.
- **Ambient, calm motion** — logo spins on hover, a pulsing "Live" ping dot, staggered 30ms feed fade-ins, framer-motion scroll parallax on the artist hero. Slow (3–20s), eased, never frantic.
- **Round everything** — circular avatars, pill indicators, `rounded-lg`/`rounded-2xl` surfaces, a pink placeholder avatar.
- **The light→dark accent swap** — dark mode deliberately shifts the accent from **pink → cyan/green** (checked checkboxes `#ff9ce3` → `#2ad4fc`; feed live dot emerald → jellygreen). The pink wordmark is the one element forced to stay pink in both modes.

**Design principles (inferred from the actual UI):**

1. **Neon accents, quiet chrome.** Deploy pastypink/pastyblue/jellygreen as punctuation on top of neutral slate surfaces — never as full backgrounds or large fills.
2. **Glass is the surface language.** Prefer `.glass` / `.glass-subtle` for panels; keep radii generous (0.75–2rem) and edges soft.
3. **Round everything.** Circular avatars, pill indicators, rounded cards/buttons; avoid hard corners.
4. **Motion should feel alive but calm.** Spinning logo, live ping, staggered fades, scroll parallax — slow, eased, ambient.
5. **Pink is the identity in light; cyan/green take over in dark.** Honor the light→dark accent swap already coded into checkboxes and the live feed.
6. **Lowercase, friendly, personal voice.** Short, casual, a little self-aware; credit real humans ("Made in Seattle by @cxy @clt and friends"); no corporate polish. Dev humor leaks through (a loading spinner's alt text is literally `alt="whyyyyy"`).
7. **Big, fluid, tightly-tracked display type.** Use `clamp()` fluid sizing with negative letter-spacing for hero headlines — the `music nerd` wordmark is the template.

**What to avoid (to stay on-brand):**

- Don't introduce a **fourth pink or a new blue.** Three pinks already exist; consolidate toward named tokens instead of inventing more hex.
- Don't make accent colors **load-bearing backgrounds** or large fills — neon-on-neon breaks the "quiet chrome" balance.
- Don't ship **opaque, hard-edged, flat cards** where a glass panel is expected.
- Don't rely on the **KoHo** class names expecting that typeface — KoHo never loads in the app; those classes render as system sans-serif.
- Don't add more **`!important` dark-mode patch overrides** — the override wall is already brittle. Prefer theming via CSS-variable tokens.
- Don't force **serious/corporate copy, ALL-CAPS shouting, or sharp geometric/brutalist styling** — it contradicts the lowercase, playful, glassy, indie personality.

---

## Color

MusicNerdWeb's color system is **three disconnected layers that never reconcile**: a 4-color brand palette in `tailwind.config.ts`, a stock untouched shadcn "slate" semantic-token layer in `globals.css`, and a dead SCSS file (`_colors.scss`) that redefines the brand under different names and is imported nowhere. The visual identity is applied almost entirely through hardcoded hex literals (200+ occurrences) and `!important` dark-mode overrides — **not** through tokens. The brand pink alone exists as **three different hex values**.

### 1. Brand palette — `tailwind.config.ts` (lines 26–29)

Plain Tailwind color extensions. **Not** wired into the semantic `--primary`/`--accent` tokens.

| Token (Tailwind class) | Value | Direct uses in `src/` | Notes |
|---|---|---|---|
| `maroon` | `#422b46` | 1 | Footer text (`.text-maroon`), forced white in dark mode |
| `pastyblue` | `#2ad4fc` | 1 | Also hardcoded for dark checkbox + moon icon |
| `pastypink` | `#ef95ff` | 93 | Most-used brand token; also the hero gradient pink |
| `jellygreen` | `#19ffb8` | (via raw hex) | Appears mainly as raw hex in ActivityFeed |

### 2. Semantic HSL tokens — `globals.css` `:root` / `.dark` (lines 35–90)

**These are verbatim stock shadcn/ui "slate" defaults** (navy `222.2 47.4% 11.2%` primary, `210 40% 96.1%` secondary, `0 84.2% 60.2%` destructive). **None carry the brand's pink/blue/green** — the semantic layer was scaffolded from shadcn and never rebranded. Consumed as `hsl(var(--token))` via `tailwind.config.ts` (lines 30–62).

| Token | Light (`:root`) | Dark (`.dark`) |
|---|---|---|
| `--background` | `0 0% 100%` | `222.2 84% 4.9%` |
| `--foreground` | `222.2 84% 4.9%` | `210 40% 98%` |
| `--card` | `0 0% 100%` | `222.2 84% 4.9%` |
| `--card-foreground` | `222.2 84% 4.9%` | `210 40% 98%` |
| `--popover` | `0 0% 100%` | `222.2 84% 4.9%` |
| `--popover-foreground` | `222.2 84% 4.9%` | `210 40% 98%` |
| `--primary` | `222.2 47.4% 11.2%` | `210 40% 98%` |
| `--primary-foreground` | `210 40% 98%` | `222.2 47.4% 11.2%` |
| `--secondary` | `210 40% 96.1%` | `217.2 32.6% 17.5%` |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` |
| `--muted` | `210 40% 96.1%` | `217.2 32.6% 17.5%` |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `215 20.2% 65.1%` |
| `--accent` | `210 40% 96.1%` | `217.2 32.6% 17.5%` |
| `--accent-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` |
| `--destructive` | `0 84.2% 60.2%` | `0 62.8% 30.6%` |
| `--destructive-foreground` | `210 40% 98%` | `210 40% 98%` |
| `--border` | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%` |
| `--input` | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%` |
| `--ring` | `222.2 84% 4.9%` | `212.7 26.8% 83.9%` |
| `--radius` | `0.5rem` | (same) |

**Chart colors** (`--chart-1..5`) are **also stock shadcn defaults**:

| | Light | Dark |
|---|---|---|
| `--chart-1` | `12 76% 61%` | `220 70% 50%` |
| `--chart-2` | `173 58% 39%` | `160 60% 45%` |
| `--chart-3` | `197 37% 24%` | `30 80% 55%` |
| `--chart-4` | `43 74% 66%` | `280 65% 60%` |
| `--chart-5` | `27 87% 67%` | `340 75% 55%` |

**Custom token** — `--subtitle-color` (line 61 / 89):

| | Light | Dark |
|---|---|---|
| `--subtitle-color` | `rgb(89, 48, 97, 0.6)` | `rgb(198, 191, 199)` |

Note: the light value uses the malformed legacy 4-arg `rgb(r,g,b,a)` syntax (should be `rgba()`); the dark value drops alpha entirely.

### 3. SCSS layer — `src/app/_colors.scss` (DEAD / unimported)

`grep` confirms this file is **imported nowhere**. It redefines the brand under a *second* naming scheme and defines `.text-color-primary { color: $primary }` (`#2ad4fc`), which collides by name with a live definition in `globals.css`.

| SCSS var | Value | Duplicates |
|---|---|---|
| `$primary` | `#2ad4fc` | `pastyblue` |
| `$secondary` | `#ef95ff` | `pastypink` |
| `$tertiary` | `#19ffb8` | `jellygreen` |
| `$grey` | `rgb(184, 182, 182)` | — |
| `$purple` | `rgb(25, 0, 50)` | — |
| `$lightpurple` | `rgb(100, 0, 200)` | — |

### 4. The "real" brand pink is fragmented into 3 hex values

The pink actually seen on screen (splash title, highlighted leaderboard rows, checked checkboxes in light mode, focus rings) is **`#ff9ce3`** — 57 occurrences — **defined nowhere in the palette**, and different from `pastypink` `#ef95ff`. A third pink `#EDADF8` powers `.text-color-primary` and `.pink-btn`.

| Pink | Where | Source |
|---|---|---|
| `#ef95ff` | `pastypink` / `$secondary` / HeroSection gradient | `tailwind.config.ts:28`, `_colors.scss:2` |
| `#ff9ce3` | "Music Nerd" title, highlight borders/glows, light checked checkbox, focus rings, ActivityFeed `--feed-artist` | 57 hardcoded uses; `globals.css:168–277`, `485–488` |
| `#EDADF8` | `.text-color-primary`, `.pink-btn` background | `globals.css:516`, `585` |

### Gradients

| Gradient | Definition | File |
|---|---|---|
| Hero brand wash | `bg-gradient-to-br from-[#ef95ff]/20 via-transparent to-[#7c3aed]/15` | `artist/[id]/_components/HeroSection.tsx:79` |
| Hero dark overlay | `bg-gradient-to-b from-black/20 to-black/50` | `HeroSection.tsx:82` |
| Press thumb fallback | `bg-gradient-to-br from-pastypink/10 via-purple-900/20 to-transparent` | `PressAndFeatures.tsx:68` |

Note the hero uses raw hex (`#7c3aed` violet-600, `#ef95ff`) while the press thumb uses the `pastypink` token + Tailwind `purple-900` — two vocabularies for the same "pink→purple" wash.

### Glass / glassmorphism — `globals.css`

The "Apple-style glass" look is built from **white-alpha layers, not tokens**:

| Utility | Light | Dark |
|---|---|---|
| `.glass` | `bg rgba(255,255,255,0.55)`; `blur(20px) saturate(180%)`; border `1px rgba(255,255,255,0.3)`; radius `1rem` | `bg rgba(30,30,30,0.55)`; border `1px rgba(255,255,255,0.08)` |
| `.glass-subtle` | `bg rgba(255,255,255,0.35)`; `blur(12px) saturate(150%)`; border `1px rgba(255,255,255,0.25)`; radius `0.75rem` | `bg rgba(40,40,40,0.4)`; border `1px rgba(255,255,255,0.06)` |
| `.scrollbar-glass` | thumb `rgba(255,255,255,0.18)`, hover `0.32`, track transparent, 6px | (same) |

### Ad-hoc palettes hidden in overrides (not tokenized)

- **Dead duplicate `:root` block (create-next-app leftover)** — `globals.css:519–528` defines a *second* `:root` with `--foreground-rgb: 0,0,0`, `--background-start-rgb: 214,219,220`, `--background-end-rgb: 255,255,255`, plus a bare `body { color: rgb(var(--foreground-rgb)); background: white }` and `.dark body { background: #1a1a1a }`. This hardcoded body background **overrides** the token-driven `@apply bg-background text-foreground` set earlier — an unmentioned dead/duplicate token layer and a direct token-vs-hardcode inconsistency.
- **Dark-mode neutral ramp** — Tailwind slate values hardcoded as hex rather than driven by `--background`/`--muted` (lines 112–532): `#1a1a1a` (dark body), `#2d3748` (panels/search), `#4a5568` (hover/border), `#f7fafc` (near-white text), `#a0aec0` (muted text), `#374151` (borders).
- **Leaderboard / UGC "mauve" family** — a purple-grey micro-palette used only through `!important` overrides (lines 132–304): `#9b83a0`, `#c6bfc7`, `#6f4b75`, `#b8b1b9`, `#a08ba8`, `rgb(89,48,97,0.6)`, `rgb(198,191,199)`, `rgb(111,75,117,0.8)`. `rgb(89,48,97,0.6)` is the same value as light `--subtitle-color` but re-typed as a literal everywhere.
- **ActivityFeed** (`ActivityFeed.tsx:69–115`) defines its **own parallel token system** via injected `--feed-*` custom properties with light/dark variants — reusing brand hex (`#ff9ce3`, `#19ffb8`, `#2ad4fc`) plus one-offs `#5a4d5e`, `#3d2f42`, `#9b8a9f`, `#059669` (emerald), `#0891b2` (cyan-600), `#c44a8c`, `#e0d8e2`. This is the best-structured light/dark token set in the app and is a good candidate for promotion into the shared layer.

### Interactive accents

- **Checkbox checked:** light `#ff9ce3`, dark `#2ad4fc`; checkmark forced `white`.
- **Theme-toggle moon icon (dark):** `#2ad4fc`.
- **Notification dot:** `bg-red-600` with a forced 2px white border in dark. (The 6 `#FF0000` hits in the tree are test-fixture `colorHex` mock values in `src/__tests__/components/ArtistLinks.test.tsx`, not UI colors — there are zero `#ff0000` literals in shipping app code.)
- **Highlight glow:** `box-shadow 0 0 20px rgba(255,156,227,0.3)` (`#ff9ce3` at 0.3), forced via `!important`.

### Theme mechanism

Dark mode is **class-based** (`darkMode: 'class'`) driven by a **custom `ThemeProvider`** (`_components/ThemeProvider.tsx`) — **not `next-themes`**, despite next-themes being the documented convention. It toggles `.light`/`.dark` on `<html>`, persists to `localStorage` key `musicnerd-theme`, and falls back to `prefers-color-scheme`. Because most of dark mode is expressed as `!important` overrides of hardcoded light values rather than swapped token values, the `.dark` block runs ~330 lines.

---

## Typography

### The headline finding: the brand typeface never loads in the app

The intended brand font is **KoHo** (Google font), but **it is not loaded anywhere in the Next.js app.** There is no `next/font` import in `src/`, no `<link>` font tag in `layout.tsx`, no `@font-face`/`@import` in `globals.css`, no font package in `package.json`, and no `fontFamily` key in `tailwind.config.ts`.

`globals.css` *declares* `font-family: "KoHo", sans-serif` in three places — `.koho-extralight` (weight 200), `.koho-light` (weight 300), and `.pink-btn` — but because KoHo never loads, **each silently falls back to `sans-serif`**. `.pink-btn` is a shipping class (the "Log In" button), so the login button renders in system sans-serif, not KoHo.

**Net effect:** the entire app renders in Tailwind's default `font-sans` stack (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, …`). No `font-family` is set on `body`. Stock Tailwind behavior, no customization — an unintended gap between design intent (KoHo) and reality (system font). **Assume the app font is the default sans stack.**

KoHo *does* load correctly, but only in two standalone static files outside the React app — `public/tmprivacy.html` and `public/mnidprivacy.html` (Google Fonts `<link>`, weights 200–700, their own inline `koho` Tailwind family). The declared brand stack is therefore **`"KoHo", sans-serif`** with weights **200, 300, 400, 500, 600, 700** — but it only manifests on the legal pages.

### Type scale — stock Tailwind defaults, no custom scale

There is **no custom `fontSize` scale**; every `text-*` resolves to Tailwind built-ins. Actual usage across `src/`:

| Tailwind class | Size / line-height | Uses | Role |
|---|---|---|---|
| `text-xs` | 12px / 16px | 108 | Badges, captions, metadata, timestamps |
| `text-sm` | 14px / 20px | 138 | **De-facto body/UI size** — table body, card descriptions, buttons |
| `text-base` | 16px / 24px | 22 | `Input` default |
| `text-lg` | 18px / 28px | 40 | Sub-headings |
| `text-xl` | 20px / 28px | 22 | Section headings |
| `text-2xl` | 24px / 32px | 14 | `CardTitle`, artist name |
| `text-3xl` | 30px / 36px | 5 | Page H1s ("Admin Dashboard", "User Profile") |
| `text-4xl` | 36px / 40px | 1 | `.artist-name` utility only (`globals.css:696`, `text-4xl text-purple-500`) |

No `text-5xl`+ anywhere. Root size is browser default 16px (never overridden).

### Weights

Four Tailwind weight utilities appear; the app maps to a narrow band:

| Class | Uses | Role |
|---|---|---|
| `font-semibold` (600) | 62 | Dominant emphasis/heading weight (card titles, badges, table headers) |
| `font-medium` (500) | 41 | Buttons (`text-sm font-medium`), labels |
| `font-bold` (700) | 33 | Page H1s (`text-3xl font-bold`) |
| `font-normal` (400) | 8 | Occasional body reset |

The two light weights the brand cares about — **200 (`.koho-extralight`) and 300 (`.koho-light`)** — are defined but never render (KoHo isn't loaded; the classes aren't applied by any component).

### Letter-spacing & line-height

Sparse, mostly on the shadcn `CardTitle` and a few headings: `leading-none` ×11, `leading-tight` ×9, `leading-relaxed` ×6, `leading-snug` ×2; `tracking-tight` ×3, `tracking-wide` ×2, `tracking-wider` ×1, `tracking-widest` ×1. Canonical pattern (stock shadcn): `CardTitle = text-2xl font-semibold leading-none tracking-tight`.

### The real display type — two hand-rolled fluid clamp headings

The only genuinely designed (non-default) type on the site is two fluid headings, both interpolated across a **360px → 1440px** viewport window:

1. **Homepage "music nerd" title** — `HomePageSplash.tsx`, inline-styled (the largest type on the site):
   - `font-size: clamp(32px, calc(32px + (84 - 32) * ((100vw - 360px) / (1440 - 360))), 84px)`
   - `letter-spacing: clamp(-1px, …, -4px)` (tightens as it grows), `line-height: 1`, `lowercase font-bold`
   - color `#ff9ce3` with `textShadow: 0 0 40px rgba(255,156,227,0.25)` — a **pink glow, not a gradient.**
2. **`.home-text-h2`** — `globals.css:616`: `font-size: clamp(28px, …, 70px)`, `letter-spacing: clamp(-1px, …, -3px)`, `line-height: clamp(36px, …, 70px)`; colored `#9b83a0` (light) / `#a08ba8` (dark) as subtitle, or `#ff9ce3` as a title variant. **Legacy/dead** — referenced only inside `globals.css`, never applied by any `.tsx`.

### Special text treatments

- **Pink glow, not gradient text.** There is **no gradient-clipped text** anywhere (`bg-clip-text` / `text-transparent` = 0 hits). All `bg-gradient-*` usages are background gradients on `<div>` overlays, not type. The only text effect is the `#ff9ce3` glow on the homepage title, defended aggressively against dark-mode overrides via ~15 `!important` selectors (`globals.css:168–277`).
- **Animated-text components exist but are unused (dead code):** `TypeWriter.tsx` (char-by-char, `startDelay=1000ms`, `typingDelay=80ms`) and `SlidingText.tsx` (vertical word-carousel, `interval=1000ms`, the only consumer of `.home-text-height`). **Neither is imported anywhere.**
- **Marquee/spin keyframes** available to text/logo rows: `scroll-left`/`scroll-right` (`20s linear infinite`) and `slow-spin` (`10s`) — all currently unused.
- **`.pink-btn`** (login button): declared KoHo (falls back to sans-serif), `18px` desktop / `16px` <768px, `color #422B46` on `#EDADF8`, `border-radius: 5px`.

---

## Layout & spacing

MusicNerdWeb has **no shared page-container primitive**. The root layout is a flex column; each page defines its own centered column with an ad-hoc `max-w-* mx-auto` and its own padding. Tailwind's stock `container` config is present but **dead** — the `.container` class appears nowhere in `src/`. Breakpoints and the radius scale are unmodified defaults; the only bespoke layout logic is fluid `clamp()` typography and one hand-written SCSS media query.

### Root shell (`src/app/layout.tsx`)

```
<body className="min-h-screen flex flex-col">
  <Nav />
  <main className="flex-grow flex flex-col min-h-0 w-full"> {children} </main>
  <Toaster />
  <Footer />   // mt-auto pins footer to bottom
```

A sticky-footer flex column. `<main>` imposes **no** max-width or padding — every page owns its own gutters.

### Page container rules (the real convention)

The dominant pattern is a **centered column** (`max-w-* mx-auto`) with padding that steps up at `sm:`, and vertical section stacking via `space-y-6`.

| Page | Container className | Max width | H-pad | V-pad |
|---|---|---|---|---|
| Nav (`NavContent.tsx:11`) | `w-full px-3 py-3 sm:p-6 … max-w-[1000px] mx-auto` | `1000px` | `px-3 → sm:6` | `py-3 → sm:6` |
| Home (`HomePageSplash.tsx:7`) | `px-6 sm:px-8 pt-0 pb-4 … w-full` + inner `max-w-2xl` | `2xl` (42rem) | `px-6 → sm:8` | `pt-0 pb-4` |
| Artist (`artist/[id]/page.tsx:107`) | `w-full max-w-[800px] mx-auto px-4 py-5 space-y-6` | `800px` | `px-4` | `py-5` |
| Admin (`admin/page.tsx:50`) | `admin-page px-4 sm:px-10 py-5 space-y-6` | none (full-bleed) | `px-4 → sm:10` | `py-5` |
| Leaderboard/Profile (`leaderboard/ClientWrapper.tsx`) | `px-5 sm:px-10 py-10` | none | `px-5 → sm:10` | `py-10` |
| Add-artist (`AddArtistContent.tsx`) | `min-h-screen flex items-center justify-center` + card `p-8 max-w-2xl w-full mx-4` | `2xl` | `mx-4` / card `p-8` | centered |
| Footer (`Footer.tsx:3`) | `px-5 py-5 w-full text-center mt-auto` | none | `px-5` | `py-5` |

Horizontal gutters cluster on **`px-4`/`px-5` → `sm:px-8`/`sm:px-10`**; vertical page padding is **`py-5`** (content pages) or **`py-10`** (leaderboard). Named max-widths are inconsistent — `800px` (artist), `2xl` (home, add-artist), `1000px` (nav) — with no shared token. The dead container config would have capped at **1400px**.

### Section / card shell (artist page)

The repeated content-section shell is a glass panel: **`glass p-4 sm:p-5 space-y-3`** (used 5× on the artist page). Page sections are separated by the parent's `space-y-6`; content inside each panel stacks on `space-y-3`.

The shadcn `Card` primitive is **stock**: `rounded-lg border bg-card shadow-sm`, with `CardHeader`/`Content`/`Footer` all on **`p-6`**. The codebase mostly uses the custom `.glass p-4/p-5` panels rather than `Card` for primary layout — so **two padding conventions coexist** for card-like surfaces.

### Breakpoints

**No custom breakpoints** — `theme.screens` is never set, so all defaults apply.

| Token | Value | Source |
|---|---|---|
| sm | 640px | Tailwind default |
| md | 768px | Tailwind default |
| lg | 1024px | Tailwind default |
| xl | 1280px | Tailwind default |
| 2xl | 1536px | Tailwind default |
| container `2xl` | **1400px** | `tailwind.config.ts:20` (overrides container max only; **unused**) |

Effective usage is a near-two-breakpoint system: `sm:` **157×**, `md:` **41×**, `lg:` **7×**, `xl:`/`2xl:` **0×**. One hand-written SCSS breakpoint at **`max-width: 768px`** (`globals.css:631`) governs `.nav-bar`, `.nav-grid`, `.home-text`, `.pink-btn` — duplicating Tailwind's `md` boundary in raw CSS. Fluid title sizing uses `clamp()` over **360px → 1440px**, independent of the breakpoint tokens.

### Spacing & gutter conventions

Drawn from Tailwind's 4px scale, with clear favorites:

- **Flex/grid gap:** `gap-2` (0.5rem) dominant (**65×**), then `gap-4` (27×), `gap-1` (21×), `gap-3` (17×), `gap-1.5` (12×). `gap-2` is the default inline-cluster gutter.
- **Vertical stacking:** `space-y-4` dominant (**24×**), `space-y-2` (17×), `space-y-3` (14×); page-level sections use `space-y-6`.
- **Component padding (stock shadcn):** Button `default h-10 px-4 py-2`, `sm h-9 px-3`, `lg h-12 px-8`, `icon h-10 w-10`; Input/SelectTrigger `h-10 px-3 py-2`; Badge `px-2.5 py-0.5`; `Dialog p-6`.
- **Custom off-scale utility:** `.pink-btn` uses `5px` vertical / `30px` horizontal padding (`4px` on mobile).

### Border-radius scale

Base token **`--radius: 0.5rem` (8px)**, not overridden in `.dark`. Tailwind derivations use the stock shadcn formula:

| Class | Formula | Computed |
|---|---|---|
| `rounded-lg` | `var(--radius)` | 8px |
| `rounded-md` | `calc(var(--radius) - 2px)` | 6px |
| `rounded-sm` | `calc(var(--radius) - 4px)` | 4px |
| `rounded-xl` | Tailwind default | 12px |
| `rounded-2xl` | Tailwind default | 16px |
| `rounded-full` | 9999px | pill |

Usage: `rounded-full` **65×** (icons, avatars, badges, genre pills), `rounded-md` **53×** (buttons, inputs, selects), `rounded-lg` **28×**, `rounded` **14×**, `rounded-sm` **9×**, `rounded-xl` **7×**. **Off-scale hardcoded radii** live in `globals.css` and do not derive from `--radius`: `.glass` = **16px**, `.glass-subtle` = **12px**, `.search-bar` & `.pink-btn` = **5px**, glass scrollbar thumb = `9999px`.

---

## Components

The UI is built on a **shadcn/ui + Radix** primitive layer in `src/components/ui/` (21 files), wrapped and extended by custom feature components in `src/app/_components/`. Most primitives are **stock shadcn defaults** (unmodified generated code); a handful were hand-edited, and **those edits are the load-bearing design facts.** Only **four** primitives use `cva` for variants — Button, Badge, Toast, Label — everything else is a fixed-className Radix wrapper.

> **Record for future contributors:** brand identity is carried by the **custom components + global utilities**, not the primitives. Style at the custom-component layer; don't fork primitives.

### Core primitives — variants & sizes (`cva`)

| Component | File | Variants | Sizes | Default | Notes |
|---|---|---|---|---|---|
| **Button** | `button.tsx` | `default`, `destructive`, `outline`, `secondary`, `ghost`, `link` | `default` (h-10 px-4 py-2), `sm` (h-9 px-3), `lg` (h-12 px-8), `icon` (h-10 w-10) | `default`/`default` | `rounded-md text-sm font-medium transition-colors`, focus-visible ring-2. **Deviation:** the `default` variant is only `bg-primary text-primary-foreground` — stock `hover:bg-primary/90` was removed, so the primary button has **no hover feedback** |
| **Badge** | `badge.tsx` | `default`, `secondary`, `destructive`, `outline` | — | `default` | `rounded-full border px-2.5 py-0.5 text-xs font-semibold`. Stock |
| **Toast** | `toast.tsx` | `default`, `destructive` | — | `default` | `rounded-md border p-6 pr-8 shadow-lg`, swipe anims. Stock (Radix Toast) |
| **Label** | `label.tsx` | none (cva with base string only) | — | — | `text-sm font-medium leading-none`. Stock |

### Non-cva primitives (fixed styling, Radix-wrapped or plain)

| Component | File | Notable styling | Stock or modified |
|---|---|---|---|
| **Card** (+ Header/Title/Description/Content/Footer) | `card.tsx` | `rounded-lg border bg-card text-card-foreground shadow-sm`; header `p-6 space-y-1.5`; title `text-2xl font-semibold tracking-tight`; content `p-6 pt-0` | Stock |
| **Input** | `input.tsx` | `flex w-full rounded-md bg-background px-3 py-2 text-base … placeholder:text-muted-foreground disabled:opacity-50` | **Heavily stripped:** no `h-10`, **no `border border-input`**, **no `focus-visible:ring`**, uses `text-base` (stock uses `text-sm`). Renders borderless & height-less — forms must re-style via `className` |
| **Textarea** | `textarea.tsx` | `min-h-[50px] w-full rounded-md border border-input bg-background text-base md:text-sm` | Modified: `min-h-[50px]` (stock 80px), and **`focus-visible:ring-2` is missing** (has `ring-ring`/`ring-offset-2` but no ring width) so the focus ring won't render |
| **Select** (Radix) | `select.tsx` | `SelectTrigger h-10 border border-input focus:ring-2`; popper slide/zoom anims | Stock |
| **Tabs** (Radix) | `tabs.tsx` | `TabsList h-10 rounded-md bg-muted`; `TabsTrigger data-[state=active]:bg-background data-[state=active]:shadow-sm` | Stock |
| **Dialog** (Radix) | `dialog.tsx` | `DialogContent max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg`, overlay `bg-black/80` | **Modified:** className prefixed with `dark:bg-gray-900 text-foreground` (hardcoded dark surface instead of `bg-background`) |
| **Table** (+ Header/Body/Footer/Row/Head/Cell/Caption) | `table.tsx` | `TableRow hover:bg-muted/50`; `TableHead h-10 px-2 text-muted-foreground` | **Modified:** `TableCell` adds `whitespace-nowrap overflow-hidden text-ellipsis` (truncating cells); padding `px-2`/`p-2` (stock `p-4`) |
| **Tooltip** (Radix) | `tooltip.tsx` | `rounded-md border bg-popover px-3 py-1.5 text-sm shadow-md`, `sideOffset=4` | Stock |
| **Checkbox** (Radix) | `checkbox.tsx` | `h-4 w-4 rounded-sm border border-primary data-[state=checked]:bg-primary` | Stock |
| **DropdownMenu** (Radix, full set) | `dropdown-menu.tsx` | `bg-popover p-1 rounded-md shadow-md`, `inset` prop, Check/Circle/ChevronRight icons | Stock |

Additional stock primitives present but not individually styled: `aspect-ratio`, `calendar`, `carousel`, `drawer`, `form`, `popover`, `toaster`.

### Signature custom components (`src/app/_components/`)

- **HomePageSplash** — homepage hero. Lowercase `music nerd` `<h1>` with fluid `clamp()` font-size (32px → 84px), negative letter-spacing, **hardcoded** `color: #ff9ce3` + pink `textShadow` glow, then mounts `ActivityFeed`. Uses raw hex, not the `pastypink` token.
- **ArtistLinks** — async server component. Platform links as **list rows** (`StaticPlatformLink` / `EditablePlatformLink` when `canEdit`) using `.link-item-grid` + `.corners-rounded` globals; splits monetized "support" links from general links, injects Spotify/Deezer.
- **ArtistLinksGrid** — the newer **grid-based** link renderer that coexists with `ArtistLinks`. Circular glassmorphism tiles: `w-12 h-12 rounded-full backdrop-blur-sm bg-white/70 dark:bg-white/10 border-white/40`, with `group-hover:scale-110` and a colored glow (pink `shadow-[0_0_15px_rgba(239,149,255,0.45)]`, blue for Deezer/listen).
- **EditableLinkIcon** — editable glass tile; adds a red `-top-1 -right-1` delete `X` gated on `EditModeContext.isEditing`, posting to `/api/directEditLink`.
- **ThemeToggle** — a **fully custom animated pill switch** (not Radix Switch). Mobile `w-12 h-12` circle and desktop `w-28 h-8` pill with sliding knob + "Dark Mode"/"Light Mode" labels; Moon/Sun icons. Colors hardcoded inline (`#2d3748`/`#f3f4f6` track, `#2ad4fc` moon = `pastyblue` value).
- **EditModeToggle** — wraps shadcn `<Button variant="outline" size="sm">`, restyled with brand `pastypink` (`border-pastypink/50 text-pastypink hover:bg-pastypink hover:text-white`); Pencil/Check icons.
- **BookmarkButton** — wraps shadcn `<Button variant="outline" size="sm">`, `localStorage`-backed toggle, fixed `w-[120px]`, `pastypink` fill/border states.
- **SlidingText** — vertical text carousel cycling `ReactNode[]` via `translateY`. Uses `.home-text-height`. **Dead code (imported nowhere).**
- **TypeWriter** — char-by-char typewriter (`startDelay=1000ms`, `typingDelay=80ms`). **Dead code (imported nowhere).**
- **LoginBtn** (`buttons/LoginBtn/index.tsx`) — **legacy pre-shadcn button**: raw `<button className="pink-btn">` (`background #EDADF8`, maroon `#422B46` text, KoHo font, `5px` radius, 18px). Evidence of an older button system still in the tree.
- **nav/** — top nav: spinning logo (`hover:animate-[spin_3s_linear_infinite]`), `SearchBar`, `AddArtist`, `Login`. `Login.tsx` branches to `NoWalletLogin` (admin gear) or `PrivyLogin` (email-first auth); also `LegacyAccountModal`.

### Design facts to record

- The shadcn primitives are **~70% stock generated code.** Meaningful hand-edits: Button (removed default hover), Input (stripped border/height/ring), Textarea (`min-h-[50px]`, missing ring width), Dialog (`dark:bg-gray-900`), Table (truncating cells, tighter padding).
- **Three parallel button systems** coexist: the cva `Button`, the legacy `.pink-btn` global class, and the fully-custom `ThemeToggle` `<button>`.
- **Two artist-link renderers** coexist: `ArtistLinks` (list rows) and `ArtistLinksGrid` (glass icon grid).
- Brand color is applied **two ways**: via Tailwind tokens (`pastypink`, `pastyblue`) in `EditModeToggle`/`BookmarkButton`, and via hardcoded hex (`#ff9ce3`, `#2d3748`, `#EDADF8`) in `HomePageSplash`, `ThemeToggle`, `.pink-btn`.
- **A dead pre-shadcn utility-class layer survives** in `globals.css:679–738`: `@apply`-based legacy classes `.navbar`, `.logo`, `.login-button` (`bg-purple-600`), `.support-button`/`.sound-button`/`.world-button` (`bg-green-500`), `.play-button` (`bg-pink-500`), `.support-input`, `.scroll-text`, and a duplicate `.search-bar { @apply p-2 border rounded }` that conflicts with the earlier `.search-bar { border-radius: 5px }`. Evidence of an older styling system predating shadcn, still in the tree.

---

## Motion & interaction

The motion system is a **three-layer stack**: (1) `tailwindcss-animate` powering stock shadcn/Radix enter/exit transitions, (2) hand-written CSS `@keyframes` in `globals.css`, and (3) `framer-motion` (v12.36.0) used in exactly three artist-page components for scroll-driven and scroll-reveal effects. The signature gesture is a **pink-glow lift** on hover (scale + colored box-shadow). There is **no `prefers-reduced-motion` handling anywhere**, and several defined animations are dead code.

### Animation tokens

| Name | Duration | Easing | Definition | Status |
|---|---|---|---|---|
| `fadeSlideIn` | `0.3s` | `ease-out both` | opacity `0→1`, `translateY(-8px→0)` | **Live** — `ActivityFeed.tsx:230` |
| `accordion-down` | `0.2s` | `ease-out` | height `0 → var(--radix-accordion-content-height)` | **Dead** — no Accordion exists |
| `accordion-up` | `0.2s` | `ease-out` | height `var(...) → 0` | **Dead** — no Accordion exists |
| `scroll-left` | `20s` | `linear infinite` | `translateX(0 → -50%)` (marquee) | **Dead** — zero usages |
| `scroll-right` | `20s` | `linear infinite` | `translateX(0 → 50%)` | **Dead** — zero usages |
| `slow-spin` | `10s` | `linear infinite` | `rotate(0 → 360deg)` | **Dead** — zero usages |

`tailwindcss-animate` supplies the `animate-in`/`animate-out`/`fade-in-0`/`zoom-in-95`/`slide-in-from-*` utilities used by the shadcn primitives — **stock strings, unmodified.** Dialog content overrides the default to `duration-200`; everything else inherits the tailwindcss-animate default (~150ms).

**Tailwind utility durations actually used (`.tsx`):** `duration-300` ×22 (de-facto standard), `duration-200` ×3, `duration-500` ×2, `duration-150` ×1, `duration-1000` ×1. **Only easing utility used:** `ease-in-out` ×6. There is **no tokenized duration/easing scale** — 300ms is convention by repetition, not definition.

**Framer-motion transitions** (inline per-component, not tokenized):

- `RevealSection.tsx` — `transition={{ duration: 0.5, ease: "easeOut", delay }}`, `initial={{opacity:0, y:30}} → whileInView={{opacity:1, y:0}}`, `viewport={{ once: true, margin: "-50px" }}`.
- `HeroSection.tsx` — scroll-linked via `useScroll` + `useTransform`: parallax `bgY 0%→50%`, `bgOpacity 1→0`, `photoScale 1→0.65`, `photoOpacity 1→0`, `stickyOpacity 0→1`.

### Interaction principles (as observed)

- **Hover — the signature "pink-glow lift."** `transition-all duration-300` + `group-hover:scale-110` + a colored glow box-shadow, on circular link icons (`ArtistLinksGrid.tsx`, `EditableLinkIcon.tsx`): `group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(239,149,255,0.45)] group-hover:bg-white/90`. Cards echo it larger — `PressAndFeatures.tsx:65` `hover:shadow-[0_0_30px_rgba(239,149,255,0.35)]`; hero photo `hover:shadow-[0_0_25px_rgba(239,149,255,0.5)]`. The "listen"-platform variant swaps the glow to **blue** `rgba(0,199,242,0.45)`. ActivityFeed rows use a subtler `hover:bg-[var(--feed-hover-bg)]` + `group-hover:h-5` accent-bar growth.
- **Hover — shadcn primitives.** Stock `transition-colors` tint-shifts (`hover:bg-secondary/80`, `hover:bg-accent`). **Deviation:** the `default` button variant has **no hover state** (stock ships `hover:bg-primary/90`).
- **Focus.** Stock focus rings on button, tabs, checkbox (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`) and badge/dialog-close/toast (`focus:ring-2`). **Deviation:** `input.tsx` has **no border and no `focus-visible` ring** — text inputs have no default focus affordance.
- **Active/press.** No `active:` classes anywhere — there is **no press-scale or tactile down-state feedback.**
- **Theme toggle** is the most deliberately animated control: pill + sliding knob use `transition-all duration-300 ease-in-out`; labels cross-fade via `transition-opacity duration-300`.
- **Loading/ambient.** `animate-spin` bordered rings (AgentWorkSection, ArtistDataSection, UserEntriesTable, UserSearch), `Loader2` (VaultManager); `animate-pulse` on the login placeholder and the "Ask" logo; `animate-ping` on the "Live" dot (`ActivityFeed.tsx:202`).
- **Scrollbars.** `.scrollbar-glass` — bespoke 6px thin scrollbar, `rgba(255,255,255,0.18)` thumb → `0.32` on `:hover` (the only scrollbar hover transition, instantaneous). `.scrollbar-hide` fully hides.

### Signature motion

1. **Fade-slide-in feed (live).** The only bespoke keyframe wired up. `ActivityFeed` applies `animate-fadeSlideIn` with **staggered `animationDelay: i*30ms`** on first load and a **depth opacity decay** (`Math.max(0.45, 1 - i*0.035)`), plus the `animate-ping` "Live" pulse.
2. **Scroll-driven hero (framer-motion).** `HeroSection` + `StickyHeroBar` layer a parallax: blurred bg drifts at half-speed and fades, the centered photo scales `1→0.65` and fades, a frosted sticky bar fades in — all pure `MotionValue`s ("no React state" per the code comment), so it's jank-free.
3. **Reveal-on-scroll (framer-motion).** `RevealSection` — reusable `whileInView` fade-up (`opacity 0→1`, `y 30→0`, `0.5s easeOut`, fires `once`).
4. **Orphaned signature motion (dead code).** `TypeWriter.tsx` and `SlidingText.tsx` are fully built but imported nowhere. `SlidingText.tsx:33` also uses `transition-max-height` — **not a valid Tailwind utility**, so the intended collapse/expand is un-animated (latent bug, dormant).

---

## Known inconsistencies to reconcile

Each row is a design-debt decision: pick one source of truth and migrate. Ordered roughly by blast radius.

| # | What diverges | Where | Suggested single source of truth |
|---|---|---|---|
| 1 | **Brand pink = 3 values.** `#ef95ff` (pastypink token / `$secondary` / hero gradient), `#ff9ce3` (wordmark + highlights + light checkbox + focus rings, 57 hardcoded uses, in no palette), `#EDADF8` (`.pink-btn` / `.text-color-primary`). | `tailwind.config.ts:28`, `globals.css:485/516/585`, `HomePageSplash.tsx:16` | One canonical `brand.pink` token in `tailwind.config.ts`; migrate the 57 `#ff9ce3` literals and `#EDADF8`. The palette pink (`#ef95ff`) isn't even the pink users see. |
| 2 | **Brand palette never reaches the semantic layer.** `--primary`/`--secondary`/`--accent`/`--ring`/`--chart-*` are 100% stock shadcn slate in both `:root` and `.dark`; brand is applied only as one-off hex on top. | `globals.css:34–91`, `tailwind.config.ts:26–29` | Decide on purpose: either keep the semantic layer intentionally neutral, or map `--primary`/`--accent`/`--ring` onto the brand palette so components inherit brand color. |
| 3 | **"Primary" means two opposite colors.** SCSS `$primary` = cyan `#2ad4fc`; shadcn `--primary` = navy slate `222.2 47.4% 11.2%`. Code reading "primary" gets different intent per system. | `_colors.scss:1`, `globals.css:42` | Rename SCSS `$primary/$secondary/$tertiary` → `$brand-*`, or feed the brand palette into the shadcn tokens so the two agree. |
| 4 | **`_colors.scss` is dead code.** Imported nowhere; duplicates the brand under a second naming scheme; its `.text-color-primary` (`$primary` = `#2ad4fc`) conflicts with the live `globals.css:516` definition (`#EDADF8`). | `_colors.scss` | Delete it, or wire it in and remove the shadowing. Do not keep a second brand naming scheme. |
| 5 | **Dark mode = ~330 lines of `!important` overrides**, not token swaps. Neutral ramp hardcoded as slate hex (`#1a1a1a`, `#2d3748`, `#4a5568`, `#f7fafc`, `#a0aec0`) bypassing `--background`/`--card`/`--muted`. | `globals.css:102–532` | Migrate to token swaps in the `.dark` block so new components inherit dark styling. Long-term this is the highest-leverage cleanup. |
| 6 | **`--subtitle-color` re-typed as a literal.** `rgb(89,48,97,0.6)` is both the light token and a raw literal in ~8 leaderboard/FunFacts overrides. Also the token uses malformed 4-arg `rgb()` (light) and drops alpha (dark). | `globals.css:61/89/138/281–303` | Reference the token instead of re-typing; fix `rgb(...)` → `rgba(...)`. |
| 7 | **KoHo never loads in the app.** No `next/font`, `<link>`, `@font-face`, or font package. `.koho-*` and `.pink-btn` fall back to system sans; KoHo only loads in `public/*privacy.html`. | `layout.tsx`, `globals.css:572/578/587`, `package.json` | Decide if KoHo is the brand font. If yes, load once via `next/font/google` in `layout.tsx` and set as Tailwind `font-sans`. If no, delete the dead `.koho-*` classes. |
| 8 | **Three parallel button systems.** cva `Button`, legacy `.pink-btn` (`LoginBtn`), hand-rolled `ThemeToggle` `<button>`. | `button.tsx`, `globals.css:584`, `ThemeToggle.tsx` | Standardize on shadcn `Button`; retire `.pink-btn`/`LoginBtn`. Keep `ThemeToggle` bespoke (documented exception). |
| 9 | **Default Button has no hover state.** Stock `hover:bg-primary/90` was removed; every other variant has a hover. | `button.tsx:12` | Restore `hover:bg-primary/90` (or document the removal as intentional). |
| 10 | **Input primitive stripped bare.** No border, no fixed height, no focus-visible ring; `text-base` instead of `text-sm`. Every form must re-add chrome. Inconsistent with fully-styled Textarea/Select. | `input.tsx:13` | Restore stock border/`h-10`/focus ring, or document Input as intentionally bare. |
| 11 | **Textarea focus ring won't render.** Has `ring-ring` + `ring-offset-2` but is missing `focus-visible:ring-2` (no ring width). | `textarea.tsx:12` | Add `focus-visible:ring-2` to match Select/Button (accessibility). |
| 12 | **Dialog hardcodes `dark:bg-gray-900`** instead of `bg-background`/`bg-card`, diverging from token-driven theming. | `dialog.tsx:41` | Use the surface token. |
| 13 | **Two artist-link renderers.** `ArtistLinks` (list rows) vs `ArtistLinksGrid` (glass icon grid) — different visual languages for the same data. | `ArtistLinks.tsx`, `ArtistLinksGrid.tsx` | Pick one canonical renderer; retire or clearly scope the other. |
| 14 | **No shared page-container primitive.** Max-widths diverge with no token: `800px` (artist), `2xl` (home/add-artist), `1000px` (nav). | per-page wrappers | Extract a `<PageContainer>` (e.g. `max-w-[800px] mx-auto px-4 sm:px-8 py-5`); reconcile the max-widths. |
| 15 | **Dead container config.** `tailwind.config.ts` defines center/padding-2rem/2xl-1400px, but `.container` is used nowhere; real content width is 800–1000px. | `tailwind.config.ts:20` | Adopt the container class, or delete the config. |
| 16 | **Inconsistent horizontal gutters.** `px-3` (nav), `px-4` (artist/admin), `px-5` (leaderboard/footer), `px-6` (home), stepping to `sm:px-8`/`sm:px-10`/`sm:p-6`. | multiple pages | Pick one step (e.g. `px-4 → sm:px-8`) and apply uniformly. |
| 17 | **768px breakpoint expressed twice.** Raw SCSS `@media (max-width:768px)` in `globals.css` **and** Tailwind `md:` utilities. | `globals.css:631` | Fold the SCSS rules into `md:` utilities, or document why nav needs hand-written CSS. |
| 18 | **Off-scale radii.** `.glass` 16px, `.glass-subtle` 12px, `.search-bar`/`.pink-btn` 5px — none derive from `--radius` (4/6/8px). | `globals.css:28/546/560/569/588` | Bring onto the `--radius` scale, or record as intentional brand exceptions. |
| 19 | **Two card padding conventions.** Custom `.glass p-4/p-5` (primary panels) vs shadcn `Card p-6`. | `globals.css`, `card.tsx` | Pick one primary panel and align padding. |
| 20 | **No motion token scale.** `duration-300` (22×) is de-facto standard, but SlidingText 500/1000ms, ThemeToggle 300ms, shadcn 150/200ms, framer 0.5s — all ad hoc. | codebase-wide | Define `--motion-fast 150ms` / `--motion-base 300ms` / `--motion-slow 500ms` + a standard easing; reference them. |
| 21 | **No `prefers-reduced-motion` guard.** Infinite spins, `animate-ping`, scroll parallax, staggered feed all run unconditionally. | codebase-wide | Add a global strategy; use framer's `useReducedMotion` for scroll effects. |
| 22 | **Two pink-glow hexes.** Hover glows use `rgba(239,149,255,x)` (`#ef95ff`); title shadow + highlight box-shadow use `rgba(255,156,227,x)` (`#ff9ce3`). | `ArtistLinksGrid.tsx`, `HomePageSplash.tsx`, `globals.css:414` | One `brand-glow` token. |
| 23 | **Two vocabularies for the pink→purple gradient.** HeroSection raw hex `from-[#ef95ff] to-[#7c3aed]`; PressAndFeatures tokens `from-pastypink via-purple-900`. | `HeroSection.tsx:79`, `PressAndFeatures.tsx:68` | One expression (prefer tokens). |
| 24 | **Dead typography.** `.home-text-h2`, `.home-text-height`, ~15 `!important` `#ff9ce3` overrides, `SlidingText.tsx`, `TypeWriter.tsx` — all legacy/unapplied. | `globals.css`, `_components/` | Delete, or wire back in. If keeping SlidingText, fix the invalid `transition-max-height`. |
| 25 | **Dead animation code.** `accordion-down`/`up` (no Accordion), `.animate-scroll-left`/`-right`, `.animate-slow-spin` — zero usages. | `tailwind.config.ts`, `globals.css` | Delete or wire up. |
| 26 | **Two fluid-heading definitions.** HomePageSplash h1 (32–84px inline) vs `.home-text-h2` (28–70px CSS) both re-implement the 360–1440px clamp by hand. | `HomePageSplash.tsx:13`, `globals.css:617` | Extract the clamp into a shared utility/token. |
| 27 | **No custom type scale or font tokens.** Every `text-*` is a stock Tailwind default; no single source of truth for the type system. | codebase-wide | Document a minimal named scale (which `text-*` + weight = H1/H2/body/caption). |
| 28 | **Cyan under two names.** `pastyblue` (Tailwind) and `$primary` (SCSS) both = `#2ad4fc`; pink has token + untracked literals. | `tailwind.config.ts`, `_colors.scss` | Consolidate naming across the two color systems. |
| 29 | **Theme uses custom `ThemeProvider`, not `next-themes`** (the documented convention). | `_components/ThemeProvider.tsx` | Document this so contributors don't assume next-themes APIs. |
| 30 | **ActivityFeed `--feed-*` is a parallel token system** — a well-structured light/dark set duplicating brand hex the rest of the app hardcodes. | `ActivityFeed.tsx:69–115` | Consider promoting into the shared token layer. |

---

## Proposing design changes

This system evolves by editing tokens, not by scattering more literals. When you propose a change:

1. **Change the token first, in the right place.** Color lives in three places today — keep them in sync deliberately:
   - **Brand palette** → `tailwind.config.ts` `theme.extend.colors` (`pastypink`/`pastyblue`/`jellygreen`/`maroon`).
   - **Semantic tokens** → `globals.css` `:root` / `.dark` (`--background`, `--primary`, `--radius`, etc.). Remember these are still stock slate — rebranding them is a deliberate, high-leverage act, not a casual edit.
   - **SCSS** (`_colors.scss`) is currently **dead** — don't add to it unless you're intentionally reviving it.
   Radius → `--radius`. Motion → introduce the `--motion-*` scale (see #20) rather than another `duration-*` literal.

2. **State the change against this doc.** Name the token/utility/component you're touching, whether you're following a convention (e.g. `.glass p-4 sm:p-5` panels, `gap-2` clusters, the pink-glow-lift hover) or introducing a new one, and — if diverging — why.

3. **Don't add a new hex, pink, blue, breakpoint, or button system.** Three pinks, two cyan names, three button systems, and two link renderers already exist. Migrate toward the named tokens; consolidate rather than extend. If you must add a one-off, add a row to [Known inconsistencies](#known-inconsistencies-to-reconcile) so it's tracked, not lost.

4. **Prefer token swaps over `!important` dark overrides.** The `.dark` override wall is the most brittle part of the system. New components should inherit dark styling from tokens; adding another `!important` patch is a regression, not a fix.

5. **Style at the custom-component layer, not the primitives.** Brand identity lives in `src/app/_components/` and the global utilities. The shadcn primitives are mostly stock — fork them only to fix a documented deviation (Input focus ring, default Button hover), not to inject brand color.

6. **Honor the personality.** Neon accents on quiet chrome; glass surfaces; round everything; calm ambient motion; lowercase friendly voice; pink identity in light, cyan/green in dark. When in doubt, the `music nerd` wordmark and the `.glass` panel are the templates.
