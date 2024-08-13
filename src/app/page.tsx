// import Carousel from "@/app/_components/carousel";
import { initializeParse } from '@parse/react-ssr';
import Carousel from "./_components/carousel";
import {PARSE_SERVER_URL, PARSE_APP_ID} from "@/env"
import Parse from "parse"
import type { InferGetServerSidePropsType, GetServerSideProps } from 'next'



export default async function HomePage() {
  // initializeParse(
  //   PARSE_SERVER_URL??"",
  //   PARSE_APP_ID??"",
  //   ""
    
  // );
  // await Parse.AnonymousUtils.logIn();
  // const featuredArtists = await Parse.Cloud.run("getFeaturedArtists");

  return (
    <div className="flex flex-col items-center w-full min-h-screen">
      <div className="flex flex-col items-center w-full">
        <h1 className="py-10 text-6xl text-white my-4">Go deep on artists</h1>
        <Carousel/>
        <Carousel/>
      </div>
    </div>
  );
};

// C:\Users\benos\Desktop\MusicNerd\MusicNerdNG\public\spinner.svg

