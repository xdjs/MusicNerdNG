import {
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Badge,
} from "musicnerdweb";

/**
 * Drawer is vaul, not Radix: it portals to document.body and its content is `fixed inset-x-0
 * bottom-0`. It renders nothing closed, so `open` is forced. `modal={false}` keeps vaul from
 * marking the page inert / locking scroll inside the preview frame — it does not change how the
 * content itself renders. Positioning classes are left alone; the card viewport is sized to fit
 * the sheet plus its overlay.
 *
 * No Drawer consumer exists in the repo yet, so this composes the mobile counterpart of the
 * artist-page "add artist data" flow.
 */
export const Open = () => (
  <Drawer open modal={false}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Add a link for Four Tet</DrawerTitle>
          <DrawerDescription>
            Pick a platform. Your submission is reviewed before it goes live.
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid grid-cols-2 gap-2 px-4">
          <Button variant="outline" className="justify-start">
            Spotify
          </Button>
          <Button variant="outline" className="justify-start">
            Bandcamp
          </Button>
          <Button variant="outline" className="justify-start">
            SoundCloud
          </Button>
          <Button variant="outline" className="justify-start">
            Deezer
          </Button>
        </div>
        <DrawerFooter>
          <Button>Continue</Button>
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
  </Drawer>
);

/**
 * A denser sheet: the mobile moderation queue for a UGC submission. Exercises DrawerHeader with
 * secondary metadata and a two-action footer (approve / reject).
 */
export const ModerationSheet = () => (
  <Drawer open modal={false}>
      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center gap-2">
            <DrawerTitle>Review submission</DrawerTitle>
            <Badge>listen</Badge>
          </div>
          <DrawerDescription>
            Submitted by @vinylghost, 2 hours ago.
          </DrawerDescription>
        </DrawerHeader>
        <div className="space-y-2 px-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Artist</span>
            <span className="font-medium">Jamie xx</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Platform</span>
            <span className="font-medium">Bandcamp</span>
          </div>
          <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
            bandcamp.com/jamiexx
          </p>
        </div>
        <DrawerFooter className="flex-row gap-2">
          <Button className="flex-1">Approve</Button>
          <DrawerClose asChild>
            <Button variant="outline" className="flex-1">
              Reject
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
  </Drawer>
);
