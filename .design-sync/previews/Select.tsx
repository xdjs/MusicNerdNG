import {
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "musicnerdweb";

/**
 * Rendered `open` — a closed Select shows only its trigger, and the listbox is the part
 * worth reviewing. `modal={false}` stops Radix from marking the rest of the frame inert.
 *
 * SelectContent is PORTALED to document.body and positioned `fixed` by Radix. Do not try to
 * re-anchor it inside the card with `className="relative"`: `cn()` is tailwind-merge, so
 * `relative` REPLACES Radix's `fixed` and the -50% transform yanks the panel off-screen.
 * Positioning is left alone here on purpose.
 *
 * Composition ported from the admin user-role filter (whitelisted-data-table.tsx), extended
 * with a SelectLabel/SelectSeparator group so the full part inventory is on screen. Note the
 * trigger DOES carry `h-10 border border-input` — unlike Input, Select was not stripped.
 */
export const Open = () => (
  <div className="w-[220px] space-y-1.5">
    <Label htmlFor="sel-role">Filter role</Label>
    <Select open modal={false} defaultValue="Whitelisted">
      <SelectTrigger id="sel-role" className="w-[220px]">
        <SelectValue placeholder="Filter Role" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Roles</SelectLabel>
          <SelectItem value="All">All Users</SelectItem>
          <SelectItem value="Admin">Admins</SelectItem>
          <SelectItem value="Whitelisted">Whitelisted Users</SelectItem>
          <SelectItem value="User">Users</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Moderation</SelectLabel>
          <SelectItem value="Hidden">Hidden Users</SelectItem>
          <SelectItem value="Banned" disabled>
            Banned Users (coming soon)
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

/**
 * Closed triggers — the only Select surface that renders inline. Left is the standard admin
 * filter; right is the SourceCard "type" pill, which squashes the trigger down to a
 * rounded-full 10px badge (`h-auto py-0.5 px-2 text-[10px]`) and colors it per source type.
 * That badge-shaped trigger is a real, load-bearing override in this repo.
 */
export const Triggers = () => (
  <div className="flex flex-wrap items-end gap-6">
    <div className="space-y-1.5">
      <Label>Placeholder (no value)</Label>
      <Select>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Filter Role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All Users</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="space-y-1.5">
      <Label>Disabled</Label>
      <Select disabled defaultValue="Deezer">
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Deezer">Deezer</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="space-y-1.5">
      <Label>SourceCard type pill</Label>
      <Select defaultValue="interview">
        <SelectTrigger className="h-auto w-auto min-w-0 gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] capitalize text-purple-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="interview">interview</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
);
