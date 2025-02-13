import { Suspense } from "react";
import SearchBar from "../_components/nav/components/SearchBar";

export default async function HomePage() {
  
    const titles = [
      {
        label: ["Music", "Nerd"],
        color: "#FF9CE3",
      },
      {
        label: ["Mindful", "Listener"],
        color: "rgb(89, 48, 97, 0.6)",
      },
      {
        label: ["Curious", "Researcher"],
        color: "rgb(89, 48, 97, 0.6)",
      },
      {
        label: ["Obsessive", "Collector"],
        color: "rgb(89, 48, 97, 0.6)",
      },
      {
        label: ["Enthusiastic", "Curator"],
        color: "rgb(89, 48, 97, 0.6)",
      },
      {
        label: ["Executive", "Producer"],
        color: "rgb(89, 48, 97, 0.6)",
      },
    ]
  
    return (
      <div className="p-2 sm:p-8 flex flex-col justify-between h-full">
        <div className="w-full">
          <div className="flex flex-col items-center md:fixed md:left-8 md:top-8 mb-4">
            <img
                src="/musicNerdLogo.png"
                className="w-auto"
                style={{
                    width: 'clamp(68px, calc(68px + (94 - 68) * ((100vw - 360px) / (1440 - 360))), 94px)'
                }}
                alt="logo"
            />
          </div>
          
          <div className="grow mb-8">
            <div className="font-bold w-full"
                style={{
                  fontSize: 'clamp(28px, calc(28px + (78 - 28) * ((100vw - 360px) / (1440 - 360))), 78px)',
                  letterSpacing: 'clamp(-1px, calc(-1px + (-3 - -1) * ((100vw - 360px) / (1440 - 360))), -3px)',
                  lineHeight: 'clamp(36px, calc(36px + (78 - 36) * ((100vw - 360px) / (1440 - 360))), 78px)'
                }}
                >
                  {titles.map((title, index) => (
                    <div key={index} style={{ color: title.color }} className="lowercase w-full flex">
                      <div className="w-1/2 text-right pr-4">
                        {title.label[0]} 
                      </div>
                      <div className="w-1/2 pl-4">
                        {title.label[1]}
                      </div>
                    </div>
                  ))}
            </div>
          </div>
          <div className="flex flex-col items-center w-full px-4">
            <div className="text-[#422B46] opacity-30 text-[20px] tracking-[-0.6px] md:text-[35px] md:tracking-[-1.1px] font-bold">
              Ask Music Nerd About an artist
            </div>
            <Suspense fallback={<div>Loading...</div>}>
                <SearchBar 
                  placeholder="Type artist"
                  className="w-full px-4 py-2 border-4 border-[#FF9CE3] rounded-lg focus:outline-none" />
             </Suspense>
          </div>
        </div>
        <div className="flex flex-col items-center">
          <p className="text-[#422B46] text-[14px] sm:text-[25px] tracking[-0.5px] font-bold">
              Made in Seattle by <a href="https://x.com/cxy" target="blank" className='link'>@<span className='underline'>cxy</span> </a>
              <a href="https://x.com/clt" target="blank" className='link'>@<span className='underline'>clt</span></a> and friends
          </p>
        </div>
      </div>
    );
  };
  
  