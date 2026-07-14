import { Checkbox, Label } from "musicnerdweb";

/**
 * Every state the primitive encodes. 16px square, `border-primary`, and on check it fills
 * with `bg-primary` — which in this app resolves to the brand pink, so Checkbox is one of
 * the few primitives where brand color reaches the semantic token layer unaided.
 *
 * BUG VISIBLE HERE: `indeterminate` renders the Check icon but NO fill. The Radix Indicator
 * is shown for both `checked` and `indeterminate`, while the background is gated on
 * `data-[state=checked]` only — so indeterminate paints a checkmark on a white square, which
 * reads as "checked, unstyled" rather than "partially selected". Stock shadcn shows a dash.
 * The admin select-all header hits this on every partial page selection.
 */
export const States = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="cb-unchecked" />
      <Label htmlFor="cb-unchecked">Unchecked</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-checked" defaultChecked />
      <Label htmlFor="cb-checked">Checked</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-ind" checked="indeterminate" />
      <Label htmlFor="cb-ind">Indeterminate (select-all, page partially selected)</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-dis" className="peer" disabled />
      <Label htmlFor="cb-dis">Disabled</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-dis-checked" className="peer" disabled defaultChecked />
      <Label htmlFor="cb-dis-checked">Disabled + checked</Label>
    </div>
  </div>
);

/**
 * The canonical call site: the row-selection column of the admin UGC table (columns.tsx).
 * Header checkbox is `indeterminate` when some-but-not-all page rows are selected; each row
 * gets an `aria-label`-only checkbox with no visible Label. Note the header reads as an
 * unfilled checkmark rather than a dash — see the `States` cell for why.
 */
export const TableSelection = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-md border border-input">
    <table className="w-full text-sm">
      <thead className="border-b border-input bg-muted/50">
        <tr className="text-left">
          <th className="w-10 px-3 py-2">
            <Checkbox checked="indeterminate" aria-label="Select all" />
          </th>
          <th className="px-3 py-2 font-medium">Artist</th>
          <th className="px-3 py-2 font-medium">Platform</th>
          <th className="px-3 py-2 font-medium">Contributor</th>
        </tr>
      </thead>
      <tbody>
        {[
          { a: "Yaeji", p: "Bandcamp", u: "0xkim.eth", sel: true },
          { a: "Arca", p: "SoundCloud", u: "nerdvana", sel: true },
          { a: "Floating Points", p: "Deezer", u: "sam.b", sel: false },
          { a: "Jamie xx", p: "Apple Music", u: "0xkim.eth", sel: false },
        ].map((r) => (
          <tr key={r.a} className="border-b border-input/60 last:border-0">
            <td className="px-3 py-2">
              <Checkbox defaultChecked={r.sel} aria-label={`Select ${r.a}`} />
            </td>
            <td className="px-3 py-2">{r.a}</td>
            <td className="px-3 py-2 text-muted-foreground">{r.p}</td>
            <td className="px-3 py-2 text-muted-foreground">{r.u}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * A checklist of platforms — the shape a "which links to sync" filter takes. Worth looking at
 * for density: at 16px with `bg-primary` pink fill and a hairline unchecked border, the
 * checked and unchecked rows carry very different visual weight in a stacked list.
 */
export const PlatformFilter = () => (
  <div className="w-full max-w-xs space-y-3 rounded-lg border border-input p-4">
    <p className="text-sm font-semibold">Sync ID mappings for</p>
    {[
      { id: "deezer", label: "Deezer", on: true },
      { id: "apple", label: "Apple Music", on: true },
      { id: "musicbrainz", label: "MusicBrainz", on: true },
      { id: "tidal", label: "Tidal", on: false },
      { id: "ytm", label: "YouTube Music", on: false },
    ].map((p) => (
      <div key={p.id} className="flex items-center gap-2">
        <Checkbox id={`pf-${p.id}`} defaultChecked={p.on} />
        <Label htmlFor={`pf-${p.id}`} className="font-normal">
          {p.label}
        </Label>
      </div>
    ))}
  </div>
);
