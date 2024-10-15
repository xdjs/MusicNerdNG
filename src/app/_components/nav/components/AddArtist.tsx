import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function AddArtist() {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline">Add Artist</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add Artist!</DialogTitle>
                    <DialogDescription>
                        Let&apos;s start by inputting their Spotify artist ID
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                        <Input
                            pattern="https://open.spotify.com/artist/[a-zA-Z0-9]+"
                            placeholder="https://open.spotify.com/artist/Id"
                            id="name"
                            className="col-span-3"
                        />
                </div>
                <DialogFooter>
                    <Button type="submit">Add Artists</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
