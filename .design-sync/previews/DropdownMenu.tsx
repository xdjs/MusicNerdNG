import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "musicnerdweb";

/**
 * A closed DropdownMenu renders nothing (content is portaled + `fixed`), so `defaultOpen` is
 * required for the card to show anything. Positioning classes are untouched — the card's
 * viewport is sized around the floating panel instead.
 *
 * Composition mirrors the nav account menu in PrivyLogin.tsx (Leaderboard / User Profile /
 * theme / Log Out).
 */
export const Open = () => (
  <div className="flex min-h-[400px] items-start justify-center pt-6">
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">@vinylghost</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={8} className="w-44">
        <DropdownMenuLabel>My account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Leaderboard</DropdownMenuItem>
        <DropdownMenuItem>User Profile</DropdownMenuItem>
        <DropdownMenuItem>Dark mode</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Log Out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

/**
 * The artist-page "add artist data" picker (AddArtistDataOptions.tsx): a scrollable list of
 * platform link examples, with the pink focus tint the repo applies to those items.
 */
export const PlatformPicker = () => (
  <div className="flex min-h-[400px] items-start justify-center pt-6">
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-11">
          Add artist data
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        sideOffset={8}
        className="max-h-52 w-56 overflow-auto"
      >
        <DropdownMenuItem className="cursor-pointer text-xs">
          bandcamp.com/artist-name
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer text-xs">
          deezer.com/artist/12345
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer text-xs">
          instagram.com/artist-name
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer text-xs">
          soundcloud.com/artist-name
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer text-xs">
          open.spotify.com/artist/1a2b3c
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer text-xs" disabled>
          x.com/artist-name
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

/**
 * Checkbox items — the coverage filter on the Agent Work tab. Sweeps the checked indicator
 * and the `pl-8` indent variant of the item.
 */
export const WithCheckboxes = () => (
  <div className="flex min-h-[400px] items-start justify-center pt-6">
    <DropdownMenu defaultOpen modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Platforms</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={8} className="w-52">
        <DropdownMenuLabel>Show mappings for</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>Deezer</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked>Apple Music</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>MusicBrainz</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>Tidal</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
