import Carousel from "./_components/carousel";
import { useRouter } from 'next/router';

export default async function HomePage() {
  return (
    <div className="flex flex-col items-center w-full min-h-screen">
      <div className="flex flex-col items-center w-full">
        <h1 className="py-10 text-6xl text-white my-4">Explore your favorite artists</h1>
        <Carousel speed={.5} direction="forward"/>
        <Carousel speed={.3} direction="backward"/>
      </div>
    </div>
  );
};

