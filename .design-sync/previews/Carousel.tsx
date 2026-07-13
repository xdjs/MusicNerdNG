import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  AspectRatio,
  Badge,
} from "musicnerdweb";

const ARTISTS = [
  ["Jamie xx", "electronic", "from-pastypink to-[#7c3aed]"],
  ["Floating Points", "modal jazz", "from-pastyblue to-jellygreen"],
  ["Yaeji", "house", "from-[#ff9ce3] to-pastyblue"],
  ["Overmono", "breakbeat", "from-jellygreen to-pastypink"],
  ["Kelela", "r&b", "from-[#7c3aed] to-pastyblue"],
  ["Four Tet", "idm", "from-pastypink to-jellygreen"],
];

/**
 * Featured-artists rail — three cards per view (`basis-1/3`). CarouselItem defaults to
 * `basis-full` (one slide fills the viewport), so a multi-up rail is entirely a call-site
 * decision: without an explicit basis you get a one-at-a-time hero, not a rail.
 *
 * The arrows are absolutely positioned OUTSIDE the track (`-left-12` / `-right-12`), so
 * the Carousel needs horizontal room around it — hence `px-12` on the wrapper. Drop that
 * padding and both buttons clip off the edge of the card.
 */
export const FeaturedArtists = () => (
  <div className="w-[560px] px-12">
    <Carousel className="w-full">
      <CarouselContent>
        {ARTISTS.map(([name, genre, grad]) => (
          <CarouselItem key={name} className="basis-1/3">
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <AspectRatio ratio={1}>
                <div className={`h-full w-full bg-gradient-to-br ${grad}`} />
              </AspectRatio>
              <div className="space-y-1.5 p-3">
                <p className="truncate text-sm font-medium leading-none">{name}</p>
                <Badge variant="secondary">{genre}</Badge>
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  </div>
);

/**
 * The default `basis-full` shape: one slide at a time, a full-bleed hero for the
 * homepage's featured artist. Because this Carousel hardcodes `loop: true` (a repo
 * modification — stock shadcn leaves loop off), both arrows are always enabled; you never
 * see the disabled end-of-track state that stock gives you for free.
 */
export const SingleSlideHero = () => (
  <div className="w-[520px] px-12">
    <Carousel className="w-full">
      <CarouselContent>
        {ARTISTS.slice(0, 3).map(([name, genre, grad]) => (
          <CarouselItem key={name}>
            <div
              className={`flex h-40 items-end rounded-xl bg-gradient-to-br ${grad} p-4`}
            >
              <div>
                <p className="text-xl font-semibold text-white drop-shadow">{name}</p>
                <p className="text-sm text-white/80">Featured this week · {genre}</p>
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  </div>
);

/**
 * A text-only rail — the "recently added" activity strip. Same `basis-1/3` sizing as the
 * artwork rail, so the gutter that CarouselContent's `-ml-4` / CarouselItem's `pl-4` create
 * is legible without artwork carrying it. Note `basis-1/2` renders unevenly here: with
 * `loop: true` embla can settle mid-snap, so odd slide counts per view are safer.
 */
export const CompactRail = () => (
  <div className="w-[560px] px-12">
    <Carousel className="w-full">
      <CarouselContent>
        {[
          ["Overmono", "Deezer + Tidal added"],
          ["Kelela", "MusicBrainz ID resolved"],
          ["Four Tet", "Bandcamp link approved"],
          ["Yaeji", "Apple Music mapped"],
          ["Jamie xx", "Beatport link approved"],
          ["Floating Points", "Wikidata ID resolved"],
        ].map(([name, note]) => (
          <CarouselItem key={name} className="basis-1/3">
            <div className="rounded-lg border bg-card p-4">
              <p className="font-medium leading-none">{name}</p>
              <p className="mt-1.5 truncate text-xs text-muted-foreground">{note}</p>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  </div>
);
