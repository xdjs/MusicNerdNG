// Tailwind config used ONLY to compile the design-sync stylesheet (.design-sync/.cache/ds-tailwind.css).
//
// Why this exists: the app's tailwind.config.ts JIT-compiles only the classes that appear in src/.
// The claude.ai/design agent writes NEW markup with utilities the app never happened to use, and a
// rendered design receives nothing but styles.css — so any class missing from this stylesheet is
// silently unstyled. We therefore extend the app config with:
//   1. content globs that also cover the authored preview cards
//   2. a safelist covering the general Tailwind utility surface + the MusicNerd brand palette
//
// Theme, plugins, and brand colors are inherited verbatim from the app config — this file adds
// coverage, it never redefines design values.
import type { Config } from "tailwindcss";
import appConfig from "../tailwind.config";

// Tailwind's default numeric scales, spelled out so safelist regexes stay readable.
const SPACE = "0|px|0\\.5|1|1\\.5|2|2\\.5|3|3\\.5|4|5|6|7|8|9|10|11|12|14|16|20|24|28|32|36|40|48|56|64|72|80|96";
const FRACTION = "1/2|1/3|2/3|1/4|3/4|1/5|2/5|3/5|4/5|1/6|5/6|1/12|5/12|7/12|11/12";
const SIZE = `${SPACE}|${FRACTION}|auto|full|screen|min|max|fit|svh|dvh|lvh`;
const TEXT = "xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl";
const WEIGHT = "thin|extralight|light|normal|medium|semibold|bold|extrabold|black";
const RADIUS = "none|sm|DEFAULT|md|lg|xl|2xl|3xl|full";
const SHADOW = "sm|DEFAULT|md|lg|xl|2xl|inner|none";
const SCALE_1_100 = "0|5|10|20|25|30|40|50|60|70|75|80|90|95|100";

// Palette. Deliberately NOT the full 22-hue Tailwind rainbow: DESIGN.md's standing rule is
// "don't introduce a fourth pink or a new blue", so we ship the brand trio, the shadcn semantic
// tokens, the neutrals, and only the accent hues the app actually reaches for (counted from src/).
// A curated palette both keeps the stylesheet small and steers the design agent on-brand.
const HUE =
  "slate|gray|zinc|neutral|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const SHADE = "50|100|200|300|400|500|600|700|800|900|950";
const BRAND = "maroon|pastyblue|pastypink|jellygreen";
const SEMANTIC =
  "border|input|ring|background|foreground|primary|secondary|destructive|muted|accent|popover|card|primary-foreground|secondary-foreground|destructive-foreground|muted-foreground|accent-foreground|popover-foreground|card-foreground";
const COLOR = `(?:${HUE})-(?:${SHADE})|(?:${BRAND})|(?:${SEMANTIC})|white|black|transparent|current|inherit`;
// Tailwind slash-opacity (bg-white/70, border-white/40) is the backbone of the .glass language.
const ALPHA = "(?:/(?:5|10|20|30|40|50|60|70|80|90))?";

/** Interaction + responsive variants worth generating for a given family. */
const V_STATE = ["hover", "focus", "focus-visible", "active", "disabled", "group-hover"];
const V_RESPONSIVE = ["sm", "md", "lg", "xl"];
const V_THEME = ["dark"];
const V_ALL = [...V_STATE, ...V_RESPONSIVE, ...V_THEME];
// Colors are the combinatorial hot spot (palette x alpha x variant). Responsive color variants are
// vanishingly rare in real markup, so colors get state+theme variants only — this is what keeps the
// stylesheet at a couple of MB instead of ~30.
const V_COLOR = ["hover", "focus", "dark", "group-hover"];

const safelist: Config["safelist"] = [
  // ---- Brand identity arbitrary values ----
  // Tailwind only emits an arbitrary value it literally finds in scanned source. The pink users
  // actually SEE — #ff9ce3, the wordmark/glow pink — is applied via inline style in the app, so
  // `text-[#ff9ce3]` was never generated and would have been silently dead for anyone writing new
  // markup. These are listed literally (patterns cannot match arbitrary values).
  "text-[#ff9ce3]",
  "bg-[#ff9ce3]",
  "border-[#ff9ce3]",
  "shadow-[0_0_40px_rgba(255,156,227,0.25)]",
  "shadow-[0_0_20px_rgba(255,156,227,0.3)]",
  // The signature "pink-glow lift" hover (and its blue listen-platform variant).
  "group-hover:shadow-[0_0_15px_rgba(239,149,255,0.45)]",
  "group-hover:shadow-[0_0_15px_rgba(0,199,242,0.45)]",
  "hover:shadow-[0_0_25px_rgba(239,149,255,0.5)]",
  "hover:shadow-[0_0_30px_rgba(239,149,255,0.35)]",
  // The hero's pink→violet wash. `#7c3aed` (violet-600) is the app's gradient partner for pink.
  "from-[#ef95ff]",
  "to-[#7c3aed]",
  "via-[#7c3aed]",
  "from-[#ff9ce3]",

  // ---- Layout ----
  // basis-* is what carousel/flex slides size on — its absence collapsed every Carousel slide.
  { pattern: /^basis-(0|1|2|3|4|5|6|8|10|12|auto|full|1\/2|1\/3|2\/3|1\/4|3\/4|1\/5|1\/6)$/, variants: V_RESPONSIVE },
  { pattern: /^table-(auto|fixed)$/ },
  { pattern: /^(flex-)?(nowrap|wrap)$/ },
  { pattern: /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|table)$/, variants: V_RESPONSIVE },
  { pattern: /^flex-(row|row-reverse|col|col-reverse|wrap|nowrap|wrap-reverse|1|auto|initial|none)$/, variants: V_RESPONSIVE },
  { pattern: /^(grow|shrink)(-0)?$/, variants: V_RESPONSIVE },
  { pattern: /^items-(start|end|center|baseline|stretch)$/, variants: V_RESPONSIVE },
  { pattern: /^justify-(start|end|center|between|around|evenly)$/, variants: V_RESPONSIVE },
  { pattern: /^self-(auto|start|end|center|stretch)$/, variants: V_RESPONSIVE },
  { pattern: /^content-(start|end|center|between|around|evenly)$/, variants: V_RESPONSIVE },
  { pattern: /^grid-cols-(1|2|3|4|5|6|7|8|9|10|11|12|none)$/, variants: V_RESPONSIVE },
  { pattern: /^grid-rows-(1|2|3|4|5|6|none)$/, variants: V_RESPONSIVE },
  { pattern: /^col-span-(1|2|3|4|5|6|7|8|9|10|11|12|full)$/, variants: V_RESPONSIVE },
  { pattern: /^row-span-(1|2|3|4|5|6|full)$/, variants: V_RESPONSIVE },
  { pattern: /^order-(1|2|3|4|5|6|first|last|none)$/, variants: V_RESPONSIVE },

  // ---- Spacing ----
  { pattern: new RegExp(`^-?(p|px|py|pt|pr|pb|pl)-(${SPACE})$`), variants: V_RESPONSIVE },
  { pattern: new RegExp(`^-?(m|mx|my|mt|mr|mb|ml)-(${SPACE}|auto)$`), variants: V_RESPONSIVE },
  { pattern: new RegExp(`^(gap|gap-x|gap-y)-(${SPACE})$`), variants: V_RESPONSIVE },
  { pattern: new RegExp(`^-?(space-x|space-y)-(${SPACE})$`), variants: V_RESPONSIVE },

  // ---- Sizing ----
  { pattern: new RegExp(`^w-(${SIZE})$`), variants: V_RESPONSIVE },
  { pattern: new RegExp(`^h-(${SIZE})$`), variants: V_RESPONSIVE },
  { pattern: new RegExp(`^(min-w|min-h)-(0|full|screen|min|max|fit)$`), variants: V_RESPONSIVE },
  { pattern: /^max-w-(0|none|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|full|min|max|fit|prose|screen-sm|screen-md|screen-lg|screen-xl|screen-2xl)$/, variants: V_RESPONSIVE },
  { pattern: /^max-h-(none|full|screen|min|max|fit)$/, variants: V_RESPONSIVE },
  { pattern: /^aspect-(auto|square|video)$/, variants: V_RESPONSIVE },

  // ---- Typography ----
  { pattern: new RegExp(`^text-(${TEXT})$`), variants: V_RESPONSIVE },
  { pattern: new RegExp(`^font-(${WEIGHT})$`), variants: V_RESPONSIVE },
  { pattern: /^font-(sans|serif|mono)$/ },
  { pattern: /^leading-(none|tight|snug|normal|relaxed|loose|3|4|5|6|7|8|9|10)$/, variants: V_RESPONSIVE },
  { pattern: /^tracking-(tighter|tight|normal|wide|wider|widest)$/, variants: V_RESPONSIVE },
  { pattern: /^text-(left|center|right|justify)$/, variants: V_RESPONSIVE },
  { pattern: /^(uppercase|lowercase|capitalize|normal-case|truncate|italic|not-italic|underline|line-through|no-underline)$/, variants: V_ALL },
  { pattern: /^line-clamp-(1|2|3|4|5|6|none)$/, variants: V_RESPONSIVE },
  { pattern: /^(whitespace|break)-(normal|nowrap|pre|pre-line|pre-wrap|words|all)$/, variants: V_RESPONSIVE },
  { pattern: /^align-(baseline|top|middle|bottom)$/ },

  // ---- Color (text / bg / border / ring / divide / gradient stops) ----
  { pattern: new RegExp(`^text-(${COLOR})$`), variants: V_COLOR },
  { pattern: new RegExp(`^bg-(${COLOR})${ALPHA}$`), variants: V_COLOR },
  { pattern: new RegExp(`^border-(${COLOR})${ALPHA}$`), variants: V_COLOR },
  { pattern: new RegExp(`^ring-(${COLOR})$`), variants: ["focus", "focus-visible", "dark"] },
  { pattern: new RegExp(`^divide-(${COLOR})$`), variants: V_THEME },
  { pattern: new RegExp(`^(from|via|to)-(${COLOR})${ALPHA}$`), variants: V_THEME },
  { pattern: /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/, variants: V_THEME },

  // ---- Borders & radius ----
  { pattern: /^border(-(0|2|4|8))?$/, variants: V_ALL },
  { pattern: /^border-(x|y|t|r|b|l)(-(0|2|4|8))?$/, variants: V_RESPONSIVE },
  { pattern: /^border-(solid|dashed|dotted|double|none)$/ },
  { pattern: new RegExp(`^rounded(-(${RADIUS}))?$`), variants: V_RESPONSIVE },
  { pattern: new RegExp(`^rounded-(t|r|b|l|tl|tr|br|bl)(-(${RADIUS}))?$`), variants: V_RESPONSIVE },
  { pattern: /^divide-(x|y)(-(0|2|4|8))?$/ },

  // ---- Effects ----
  { pattern: new RegExp(`^shadow(-(${SHADOW}))?$`), variants: V_ALL },
  { pattern: new RegExp(`^opacity-(${SCALE_1_100})$`), variants: V_ALL },
  { pattern: /^(backdrop-)?blur(-(none|sm|md|lg|xl|2xl|3xl))?$/, variants: V_THEME },
  { pattern: /^backdrop-saturate-(0|50|100|150|200)$/ },
  { pattern: /^(overflow|overflow-x|overflow-y)-(auto|hidden|clip|visible|scroll)$/, variants: V_RESPONSIVE },
  { pattern: /^ring(-(0|1|2|4|8|inset))?$/, variants: V_ALL },
  { pattern: /^ring-offset-(0|1|2|4|8)$/, variants: V_ALL },
  { pattern: /^object-(contain|cover|fill|none|scale-down|center|top|bottom|left|right)$/ },

  // ---- Position ----
  { pattern: /^(static|fixed|absolute|relative|sticky)$/, variants: V_RESPONSIVE },
  { pattern: new RegExp(`^-?(inset|inset-x|inset-y|top|right|bottom|left)-(${SPACE}|${FRACTION}|auto|full)$`), variants: V_RESPONSIVE },
  { pattern: /^z-(0|10|20|30|40|50|auto)$/, variants: V_RESPONSIVE },

  // ---- Transform & motion (the "pink-glow lift" language) ----
  { pattern: new RegExp(`^scale(-(x|y))?-(${SCALE_1_100}|105|110|125|150)$`), variants: V_ALL },
  { pattern: /^-?rotate-(0|1|2|3|6|12|45|90|180)$/, variants: V_ALL },
  { pattern: new RegExp(`^-?(translate-x|translate-y)-(${SPACE}|${FRACTION}|full)$`), variants: V_ALL },
  { pattern: /^transition(-(none|all|colors|opacity|shadow|transform))?$/, variants: V_ALL },
  { pattern: /^duration-(0|75|100|150|200|300|500|700|1000)$/ },
  { pattern: /^ease-(linear|in|out|in-out)$/ },
  { pattern: /^delay-(0|75|100|150|200|300|500|700|1000)$/ },
  { pattern: /^animate-(none|spin|ping|pulse|bounce|fadeSlideIn|accordion-down|accordion-up)$/ },
  { pattern: /^(cursor|select|pointer-events)-(auto|none|pointer|default|text|not-allowed|all)$/, variants: V_STATE },
  { pattern: /^(origin)-(center|top|bottom|left|right)$/ },
  { pattern: /^(sr-only|not-sr-only)$/ },
];

const config = {
  ...appConfig,
  content: [
    "./src/**/*.{ts,tsx}",
    // authored preview cards — their layout glue must compile too
    "./.design-sync/previews/**/*.{ts,tsx}",
  ],
  safelist,
} satisfies Config;

export default config;
