"use client"

import { Suspense } from "react";
import SearchBar from "./nav/components/SearchBar";
import SlidingText from "./SlidingText";
import TypewriterText from "./TypeWriter";
import Login from "./nav/components/Login";

export default function HomePage({ animation }: { animation: string }) {

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

    const titleNodes = titles.map((title, index) => (
        <div key={index} style={{ color: title.color }} className="lowercase w-full flex home-text-h2">
            <h2 className="w-1/2 text-right pr-[0.4rem]">
                {title.label[0]}
            </h2>
            <h2 className="w-1/2 pl-[0.4rem]">
                {title.label[1]}
            </h2>
        </div>
    ))

    const slidingNodes = titles.map((title, index) => (
        <div key={index} style={{ color: title.color }} className="lowercase w-full justify-center flex home-text-h2">
            <h2 className="">
                {title.label[0]} {" "} {title.label[1]}
            </h2>
        </div>
    ))

    function getTypewriterNodes(titles: { label: string[], color: string }[]) {
        let prevCharCount = 0;
        return titles.map((title, index) => {
            const charCount = title.label[1].length;
            const delay = 80 * (charCount + prevCharCount) + index * 100;
            prevCharCount += charCount;
            return (
                <div key={index} style={{ color: title.color }} className="lowercase w-full flex home-text-h2">
                    <h2 className="w-1/2 text-right pr-[0.4rem]">
                        {title.label[0]}
                    </h2>
                    <h2 className="w-1/2 pl-[0.4rem]">
                        <TypewriterText text={title.label[1]} startDelay={delay} />
                    </h2>
                </div>
            )
        })
    }

    // const typeWriterNodes = titles.map((title, index) => (
    //     <div key={index} style={{ color: title.color }} className="lowercase w-full flex home-text-h2">
    //     <h2 className="w-1/2 text-right pr-[0.4rem]">
    //         {title.label[0]}
    //     </h2>
    //     <h2 className="w-1/2 pl-[0.4rem]">
    //         <TypewriterText texts={[...title.label[1]]} delay={100} />
    //     </h2>
    // </div>
    // ))

    const animations = {
        static: titleNodes,
        slide: <SlidingText items={slidingNodes} interval={800} />,
        typewriter: getTypewriterNodes(titles),
    }

    function getAnimation(animation: string) {
        return animations[animation as keyof typeof animations];
    }

    return (
        <div className="p-6 sm:p-8 flex flex-col justify-center flex-grow h-full w-full">
            <div className="absolute top-6 right-6">
                <Login buttonStyles="" />
            </div>

            <div className="w-full">
                <div className="flex flex-col items-center md:fixed md:left-8 md:top-8 mb-4">
                    <img
                        src="/icon.ico"
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
                        {getAnimation(animation)}
                    </div>
                </div>
                <div className="flex flex-col items-center w-full px-4">
                    <div className="text-[#422B46] opacity-30 text-[20px] tracking-[-0.4px] md:text-[35px] md:tracking-[-1.1px] font-bold mb-3">
                        Ask Music Nerd about an artist
                    </div>
                    <Suspense fallback={<div>Loading...</div>}>
                        <SearchBar isTopSide={true} />
                    </Suspense>
                </div>
            </div>
            {/* <div className="flex flex-col items-center">
          <p className="text-[#422B46] text-[14px] sm:text-[25px] tracking[-0.5px] font-bold">
              Made in Seattle by <a href="https://x.com/cxy" target="blank" className='link'>@<span className='underline'>cxy</span> </a>
              <a href="https://x.com/clt" target="blank" className='link'>@<span className='underline'>clt</span></a> and friends
          </p>
        </div> */}
        </div>
    );
};

