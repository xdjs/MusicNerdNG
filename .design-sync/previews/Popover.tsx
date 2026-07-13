import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Badge,
} from "musicnerdweb";

/**
 * Popover portals to document.body and positions itself `fixed` against its trigger, so it
 * only renders when forced open — hence `defaultOpen`. Positioning classes are left alone;
 * the card viewport is sized to fit the floating panel.
 *
 * Composition follows the profile DatePicker (the repo's only Popover), generalized to the
 * artist-page "link details" affordance.
 */
export const Open = () => (
  <div className="flex min-h-[360px] items-start justify-center pt-6">
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Spotify link details</Button>
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={8}>
        <div className="space-y-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold leading-none">Spotify</h4>
            <p className="text-sm text-muted-foreground">
              Added by @vinylghost on Mar 4, 2025.
            </p>
          </div>
          <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
            open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi
          </p>
          <div className="flex items-center gap-2">
            <Badge>listen</Badge>
            <span className="text-xs text-muted-foreground">Verified link</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>
);

/**
 * Wider panel with a form-ish body: the "add a platform link" flow. Shows that PopoverContent's
 * default `w-72` is overridable and that padding survives a denser layout.
 */
export const WithActions = () => (
  <div className="flex min-h-[360px] items-start justify-center pt-6">
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Add link</Button>
      </PopoverTrigger>
      {/* Radix autofocuses the first field on open, which paints a native focus ring in the
          capture; suppressed so the card shows the resting state. */}
      <PopoverContent
        align="center"
        sideOffset={8}
        className="w-80"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold leading-none">
              Suggest a link for Jamie xx
            </h4>
            <p className="text-sm text-muted-foreground">
              Submissions are reviewed by a moderator before they go live.
            </p>
          </div>
          {/* Input ships with no border/height of its own — styled here so it reads as a field. */}
          <Input
            defaultValue="bandcamp.com/jamiexx"
            className="h-10 w-full rounded-md border border-input px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
            <Button size="sm">Submit</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>
);
