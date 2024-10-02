import Carousel from "./_components/carousel";

export default async function HomePage() {
  return (
    <div className="flex flex-col items-center w-full overflow-hidden">
      <div className="flex flex-col items-center w-full">
        <h1 className="home-text text-6xl text-white my-4">Explore your favorite artists</h1>
        <Carousel speed={.5} direction="forward"/>
        <Carousel speed={.3} direction="backward"/>
      </div>
    </div>
  );
};

