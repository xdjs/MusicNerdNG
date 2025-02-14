import HomePageSplash from "./_components/HomePageSplash";

export default async function HomePage() {
  return (
    <div className="flex flex-col items-center w-full overflow-hidden">
      <div className="flex flex-col items-center w-full pb-10">
        <HomePageSplash/>
      </div>
    </div>
  );
};

