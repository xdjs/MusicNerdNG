import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import ArtistLinks from "./ArtistLinks";
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
import { Link, MessageSquare } from "lucide-react";
import AddArtistData from "./AddArtistData";
import LLMChat from "./LLMChat";
import { ArtistLink } from "@/server/utils/queriesTS";

export default function Dashboard2({ artist, img, bio, session, availableLinks, isOpenOnLoad }: { artist: Artist, img: string, bio: string, session: Session | null, availableLinks: ArtistLink[], isOpenOnLoad: boolean }) {
    return (
        <Tabs defaultValue="artist" className="max-w-full w-[400px] px-4 md:px-0">
            <TabsList className="grid w-full grid-cols-3 md:grid-cols-2 h-auto items-stretch ">
                <TabsTrigger className="text-2xl data-[state=active]:bg-pastypink/90 " value="artist">🧑‍🎤</TabsTrigger>
                <TabsTrigger className="text-2xl md:hidden data-[state=active]:bg-pastyblue/90 data-[state=active]:text-white" value="LLMChat">
                    <img src="/icon.ico" alt="logo" className=" w-8 drop-shadow-lg" />
                </TabsTrigger>
                <TabsTrigger className="text-2xl data-[state=active]:bg-pastypink/90 data-[state=active]:text-white md:data-[state=active]:bg-pastyblue/90" value="presences"><Link /></TabsTrigger>
            </TabsList>
            <TabsContent value="artist">
                <Card className="h-[520px] overflow-y-auto scrollbar-hide">
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
            <TabsContent value="LLMChat" className="md:hidden">
                <LLMChat artist={artist} />
            </TabsContent>
            <TabsContent value="presences">
                <Card className="h-[520px] flex flex-col overflow-y-scroll scrollbar-hide">
                    <CardHeader>
                        <CardTitle className="flex gap-3 items-center">
                            <AddArtistData artist={artist} session={session} availableLinks={availableLinks} isOpenOnLoad={isOpenOnLoad} spotifyImg={img} />
                            <p>{artist.name}&apos; Presences</p>
                        </CardTitle>
                        <CardDescription >
                            If we&apos;re missing links, help the artist out by adding them here!
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 flex-grow">
                            <ArtistLinks links={availableLinks} />
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
    )
}
