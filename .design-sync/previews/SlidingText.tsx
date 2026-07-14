import { SlidingText } from "musicnerdweb";

/**
 * A vertical word carousel: it takes `ReactNode[]`, stacks them, and translates the stack
 * up by one slot every `interval` ms until it reaches the last item — then it resets to 0
 * and "expands" (stops animating). Each slot is clamped to the `.home-text-height` global
 * (36px → 70px, fluid) and the outer div is `overflow-hidden`, so exactly one item shows.
 *
 * Because it animates on a timer, a static capture freezes one frame. That is the honest
 * artifact — the interval here is stretched so the captured frame is a stable one.
 *
 * Two traps, both learned the hard way:
 *  • Do NOT typeset slots with the `.home-text-h2` global. It looks like a pure type class
 *    but globals.css also attaches `color: … !important` to it (`:first-child` → #ff9ce3,
 *    everything else → #9b83a0), which silently overrides any `text-*` utility on the node.
 *    Size the slots with plain Tailwind and keep colour under your own control.
 *  • The source declares `transition-max-height`, which is not a real Tailwind utility, so
 *    the collapse is instant rather than eased. Left as-is; that's the shipped behavior.
 */

/**
 * Sizing rule for slots: the component wraps each node in a div whose `max-height` is the
 * `.home-text-height` clamp (36→70px, fluid), but it never sets a `height`. So a node
 * SHORTER than the clamp leaves the slot short of the window and the NEXT word peeks in
 * underneath. Every node therefore gets a fixed `h-16` box — taller than the clamp at any
 * viewport, so each slot fills the window exactly and only one word is ever visible.
 */
const SLOT = "flex h-16 items-center text-4xl font-bold";

/**
 * The homepage hero pattern this exists for: a fixed lead-in on the left, the rotating noun
 * on the right. Slots are ReactNode, so each carries its own brand colour — the frame you
 * catch is whichever word is up.
 */
export const HeroRotator = () => (
  <div className="flex w-full max-w-xl items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-6">
    <span className="text-4xl font-bold text-maroon">Discover</span>
    <SlidingText
      interval={9000}
      items={[
        <span key="a" className={SLOT} style={{ color: "#ff9ce3" }}>
          artists
        </span>,
        <span key="b" className={`${SLOT} text-pastyblue`}>
          labels
        </span>,
        <span key="c" className={`${SLOT} text-jellygreen`}>
          collectors
        </span>,
      ]}
    />
  </div>
);

/**
 * The same machine over a saturated backdrop — the only context where the brand's glass and
 * gradient surfaces actually read (`.glass` is white-on-white and invisible otherwise).
 * Slots here are composites, not bare strings, which is the point of the `ReactNode[]` API.
 */
export const OnGradient = () => (
  <div className="flex w-full max-w-xl items-center justify-center rounded-xl bg-gradient-to-br from-pastypink via-purple-600 to-pastyblue px-6 py-8">
    <SlidingText
      interval={9000}
      items={[
        <span key="a" className={`${SLOT} text-white`}>
          Sudan Archives
        </span>,
        <span key="b" className={`${SLOT} text-white`}>
          JPEGMAFIA
        </span>,
        <span key="c" className={`${SLOT} text-white`}>
          Yaeji
        </span>,
      ]}
    />
  </div>
);
