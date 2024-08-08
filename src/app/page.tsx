import Carousel from "@/app/_components/carousel";


const HomePage = () => {
  const images = [
    '/artist1.jpg',
    '/artist2.jpg',
  ];

  return (
    <div className="bg-jellygreen flex flex-col items-center w-full min-h-screen">
      <div className="flex flex-col items-center w-full">
        <h1 className="py-10 text-4xl text-white my-4">Go deep on artists</h1>
        <Carousel direction="forward" speed={2}/>
        <Carousel direction="backward" speed={2}/>
      </div>
    </div>
  );
};

export default HomePage;

