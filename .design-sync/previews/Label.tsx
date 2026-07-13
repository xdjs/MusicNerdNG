import { Checkbox, Input, Label } from "musicnerdweb";

/**
 * Label is the thinnest wrapper in the kit: a Radix Label with a single, variant-less cva
 * — `text-sm font-medium leading-none` plus the `peer-disabled:` pair. There is no size or
 * tone axis to show, so the axis worth showing is *what it labels*.
 */
export const Default = () => (
  <div className="w-full max-w-sm space-y-1.5">
    <Label htmlFor="lb-artist">Artist name</Label>
    <Input
      id="lb-artist"
      defaultValue="Floating Points"
      className="h-10 rounded-md border border-input px-3 py-2"
    />
  </div>
);

/**
 * `peer-disabled:opacity-70` is the only state the cva encodes, and it is a footgun: it fires
 * off the SIBLING control's `peer` marker, so a disabled control that forgot `className="peer"`
 * leaves its label at full strength — indistinguishable from an enabled field.
 *
 * The two rows below are the whole axis: enabled at full strength, and a disabled control
 * whose Label has dimmed itself to 70%. The footgun is that this ONLY happens if the control
 * carries `className="peer"` — a disabled control that forgot the marker leaves its label at
 * full strength, indistinguishable from row 1. Worth noting that 70% opacity is a very quiet
 * disabled signal to begin with.
 */
export const PeerDisabled = () => (
  <div className="flex w-full max-w-lg flex-col gap-4">
    <div className="flex items-center gap-2">
      <Checkbox id="lb-enabled" className="peer" defaultChecked />
      <Label htmlFor="lb-enabled" className="text-base">
        Whitelisted contributor — enabled
      </Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="lb-peer" className="peer" disabled />
      <Label htmlFor="lb-peer" className="text-base">
        Admin role — disabled, label dimmed via peer
      </Label>
    </div>
  </div>
);

/**
 * The repo leans on Label for two things it wasn't really designed for: an inline error
 * string (AddArtistData renders rejection text as a red `<Label>`), and admin field
 * captions. Both are just className overrides on the same primitive — shown as shipped.
 */
export const AsErrorText = () => (
  <div className="w-full max-w-md space-y-3">
    <div className="space-y-1.5">
      <Label htmlFor="lb-url">Platform link</Label>
      <Input
        id="lb-url"
        defaultValue="https://sondcloud.com/arca1000000"
        className="h-10 rounded-md border border-destructive px-3 py-2"
      />
      <Label className="text-xs leading-relaxed text-red-600">
        We couldn&apos;t match that host to any platform in urlmap. Supported: Spotify,
        Deezer, Bandcamp, SoundCloud, Apple Music.
      </Label>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="lb-key" className="uppercase tracking-wide text-muted-foreground">
        MCP key label
      </Label>
      <Input
        id="lb-key"
        defaultValue="id-mapping-agent"
        className="h-10 rounded-md border border-input px-3 py-2"
      />
    </div>
  </div>
);
