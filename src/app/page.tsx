import Carousel from "./_components/carousel";
import { getFeaturedArtistsTS } from "@/server/utils/queriesTS";

export default async function HomePage() {
  const featuredArtists = await getFeaturedArtistsTS();

  return (
    <div className="flex flex-col items-center w-full overflow-hidden">
      <div className="flex flex-col items-center w-full pb-10">
        <h1 className="home-text text-6xl my-4">Explore your favorite artists</h1>
        <Carousel speed={.5} direction="forward" featuredArtists={featuredArtists}/>
      </div>
    </div>
  );
};

