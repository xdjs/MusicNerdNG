# Building with the MusicNerd design system

MusicNerd is a **playful, indie, candy-neon music directory dressed in Apple-style frosted glass.**
Neon accents on quiet chrome; glass surfaces; round everything; calm ambient motion; a lowercase,
friendly voice. When in doubt, the `music nerd` wordmark and the `.glass` panel are the templates.

## Setup: wrap the tree in ThemeProvider

`ThemeProvider` owns the light/dark class on the root and is what `ThemeToggle` reads through
`useTheme()`. Without it, `ThemeToggle` throws. `EditModeProvider` gates the artist-page edit
affordances (`EditModeToggle` renders inert unless `canEdit` is true).

```jsx
<ThemeProvider>
  <EditModeProvider canEdit={false}>
    <YourScreen />
  </EditModeProvider>
</ThemeProvider>
```

Dark mode is **class-based** (`.dark` on `<html>`), driven by this custom provider — *not*
`next-themes`. Don't reach for `next-themes` APIs.

## The styling idiom: Tailwind utilities

Everything is styled with **Tailwind utility classes** — there are no CSS modules and no style props.
Compose layout with utilities; use components for the controls.

**Brand palette** (real Tailwind classes — `bg-`, `text-`, `border-`):

| Class | Value | Use |
|---|---|---|
| `pastypink` | `#ef95ff` | the brand token — accents, borders, glows |
| `pastyblue` | `#2ad4fc` | cyan accent; takes over from pink in dark mode |
| `jellygreen` | `#19ffb8` | mint accent (live/success) |
| `maroon` | `#422b46` | deep-aubergine ink for body/footer text |

**Semantic tokens** (shadcn slate, consumed as `bg-*`/`text-*`): `background`, `foreground`, `card`,
`popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, each
with a `-foreground` counterpart. Radius derives from `--radius` (8px): `rounded-lg` 8, `rounded-md`
6, `rounded-sm` 4.

⚠️ **The semantic layer is stock shadcn slate and carries NO brand color.** `bg-primary` is navy,
not pink. To put brand color on a component, add a brand class at the call site — never fork the
primitive. This is exactly what the real app does:

```jsx
<Button variant="outline" size="sm"
  className="border-pastypink/50 text-pastypink hover:bg-pastypink hover:text-white">
  Edit mode
</Button>
```

**The pink users actually see is `#ff9ce3`** — the wordmark, highlight glows, focus rings. It is in
no palette. `text-[#ff9ce3]`, `bg-[#ff9ce3]` and `border-[#ff9ce3]` are available. Three pinks exist
(`#ef95ff`, `#ff9ce3`, `#EDADF8`); prefer `pastypink` for chrome and `#ff9ce3` for the identity
glow. **Do not invent a fourth pink or a new blue.**

**One exception, and it is a global one:** `globals.css` ships an *unscoped* `!important` rule —
`[data-state="checked"] { background-color: #ff9ce3 }` (cyan `#2ad4fc` in dark). It matches **any**
Radix element in the checked state, so a checked `Checkbox`, the selected `SelectItem`, and a
checked `DropdownMenuCheckboxItem` all pick up brand pink automatically. That is the one place brand
color reaches the primitives without a call-site class. Don't fight it, and don't try to restyle a
checked state with a utility — `!important` will win.

⚠️ **This stylesheet is pre-compiled — there is no Tailwind JIT at render time.** The standard
utility scale is fully available (spacing, sizing, color, type, flex/grid, radius, shadow, opacity,
transitions, and the `sm:`/`md:`/`lg:`/`hover:`/`focus:`/`dark:`/`group-hover:` variants). But an
**arbitrary value you invent** (`p-[13px]`, `bg-[#123456]`) will silently not resolve unless it
already appears above or in the app's source. For a genuine one-off, use an inline `style` — which
is what the app itself does for the wordmark.

## Glass is the surface language

`.glass` and `.glass-subtle` are global utility classes — the primary panel surface, used in
preference to `Card` for page sections.

```jsx
<section className="glass space-y-3 p-4 sm:p-5">…</section>
```

`.glass` = `rgba(255,255,255,0.55)` + `backdrop-filter: blur(20px) saturate(180%)` + 16px radius.
**It is invisible on a white background** — it only reads over color, so give it a backdrop
(a gradient wash, artwork, a photo). `.glass-subtle` is the lighter 12px-radius variant.

## Signature patterns worth copying

**The wordmark** — the single most recognizable element. Lowercase, fluid-clamped, pink glow (not a
gradient):

```jsx
<h1 className="lowercase font-bold" style={{
  fontSize: 'clamp(32px, calc(32px + 52 * ((100vw - 360px) / 1080)), 84px)',
  letterSpacing: 'clamp(-1px, calc(-1px + -3 * ((100vw - 360px) / 1080)), -4px)',
  lineHeight: 1, color: '#ff9ce3',
  textShadow: '0 0 40px rgba(255, 156, 227, 0.25)',
}}>music nerd</h1>
```

**The pink-glow lift** — the signature hover, on circular link tiles and cards:
`transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(239,149,255,0.45)]`.
Listen-platform tiles swap the glow to blue (`rgba(0,199,242,0.45)`).

**Glass icon tiles** (the artist-page link grid — a component you won't find in this library, so
build it from utilities):
`w-12 h-12 rounded-full backdrop-blur-sm bg-white/70 dark:bg-white/10 border border-white/40`.

**Page shell** — a centered column; there is no container primitive:
`w-full max-w-[800px] mx-auto px-4 py-5 space-y-6`. Sections stack on `space-y-6`, content inside a
panel on `space-y-3`, inline clusters on `gap-2`. `duration-300` is the de-facto motion standard.

## Traps

- **`Input` ships with no border, no height, and no focus ring.** A bare `<Input/>` is an invisible
  blank. Always add chrome: `<Input className="h-10 rounded-md border border-input px-3 py-2" />`.
  `Textarea` is likewise missing its focus-ring width.
- **The `default` Button variant has no hover state** (stock `hover:bg-primary/90` was removed).
- **KoHo is not a usable font.** `globals.css` declares `.koho-extralight`, `.koho-light`, and
  `.pink-btn` in `"KoHo", sans-serif`, but KoHo is loaded nowhere — those classes silently render as
  system sans. **Assume the app font is the default Tailwind sans stack.** Don't apply `.koho-*`.
- Prefer token swaps over `!important` dark-mode patches, and prefer `.glass` panels over opaque,
  hard-edged flat cards.
- Avoid ALL-CAPS shouting, corporate copy, and sharp brutalist geometry — they contradict the
  lowercase, glassy, playful personality.

## Where the truth lives

Read `styles.css` (and the `_ds_bundle.css` it imports) for the real token and utility definitions,
`guidelines/DESIGN.md` for the full design system of record, and each component's `.prompt.md` +
`.d.ts` for its actual API.
