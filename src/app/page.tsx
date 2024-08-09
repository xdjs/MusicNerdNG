import Carousel from "@/app/_components/carousel";


const HomePage = () => {
  return (
    <div className="flex flex-col items-center w-full min-h-screen">
      <div className="flex flex-col items-center w-full">
        <h1 className="py-10 text-6xl text-white my-4">Go deep on artists</h1>
        <Carousel direction="forward" speed={.2}/>
        <Carousel direction="backward" speed={.3}/>
      </div>
    </div>
  );
};

export default HomePage;

