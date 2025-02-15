import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import { Artist } from "@/server/db/DbTypes";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Session } from "next-auth";
import { UrlMap } from "@/server/db/DbTypes";
import { Link } from "lucide-react";
import AddArtistData from "./AddArtistData";

export default function Dashboard2({ artist, img, bio, session, availableLinks, isOpenOnLoad }: { artist: Artist, img: string, bio: string, session: Session | null, availableLinks: UrlMap[], isOpenOnLoad: boolean }) {
    return (
        <Tabs defaultValue="artist" className="w-full max-w-[400px] px-4">
            <TabsList className="grid w-full grid-cols-2 h-auto gap-1 items-stretch">
                <TabsTrigger className="text-xl data-[state=active]:bg-pastypink/90" value="artist">🧑‍🎤</TabsTrigger>
                <TabsTrigger className=" text-xl data-[state=active]:bg-pastyblue/90 data-[state=active]:text-white  " value="presences"><Link /></TabsTrigger>
            </TabsList>
            <TabsContent value="artist">
                <Card>
                    <CardHeader>
                        <AspectRatio ratio={1 / 1} className="flex items-center place-content-center bg-muted rounded-md overflow-hidden w-full mb-4">
                            {(img) && <img src={img} alt="Artist Image" className="object-cover w-full h-full" />}
                        </AspectRatio>
                        <CardTitle>
                            {artist.name}
                        </CardTitle>
                        <CardDescription>
                            {bio}
                        </CardDescription>
                    </CardHeader>
                </Card>
            </TabsContent>
            <TabsContent value="presences">
                <Card className="min-h-[400px]">
                    <CardHeader>
                        <CardTitle className="flex gap-3 items-center">
                            <AddArtistData artist={artist} session={session} availableLinks={availableLinks} isOpenOnLoad={isOpenOnLoad} spotifyImg={img} />
                            <p>{artist.name}'s Presences</p>
                        </CardTitle>
                        <CardDescription >
                            If we're missing links, help the artist out by adding them here!
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div>

                        </div>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
}
