import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "musicnerdweb";

/**
 * Rendered `open` so the open state is what the card actually shows — a closed Dialog
 * renders nothing. Ported from the admin "Create MCP API Key" modal, which is the
 * canonical Dialog composition in this repo.
 *
 * `modal={false}` keeps Radix from marking the rest of the page inert and locking scroll
 * inside the preview frame; it does not change how the content itself renders.
 *
 * Note DialogContent hardcodes `dark:bg-gray-900` instead of the `bg-background` token
 * (DESIGN.md known inconsistency #12) — shipped behavior, shown as-is.
 */
export const Open = () => (
  <Dialog open modal={false}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create MCP API Key</DialogTitle>
        <DialogDescription>
          Enter a label to identify this key (e.g. agent name or purpose).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="key-label">Label</Label>
        <Input
          id="key-label"
          placeholder="id-mapping-agent"
          defaultValue="id-mapping-agent"
          className="h-10 rounded-md border border-input px-3 py-2"
        />
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Create key</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/**
 * A destructive confirmation — the other shape Dialog is used for in admin
 * (revoke key, delete submission).
 */
export const Destructive = () => (
  <Dialog open modal={false}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Revoke this key?</DialogTitle>
        <DialogDescription>
          `id-mapping-agent` will immediately lose write access to the MCP server. This
          cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Revoke key</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
