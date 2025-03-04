"use client"

import Link from "next/link"
import SpotifySearchBar from "./components/SpotifySearchBar"
import AddArtist from "./components/AddArtist";
import Login from "@/app/_components/nav/components/Login";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import LoginProviders from "@/app/_components/nav/components/LoginProviders";
import { Suspense } from "react";

export default function Wrapper() {
    return (
        <LoginProviders>
            <Nav />
        </LoginProviders>
    )
}

function Nav() {
    const { data: session } = useSession();
    const pathname = usePathname();
    if (pathname === "/") return null;

    return (
        <nav className="p-6 nav-bar flex items-center justify-between max-w-[1000px] mx-auto">

            <Link href={"/"} className="">
                <img
                    src="/musicNerdLogo.png"
                    className="w-16 hover:animate-[spin_3s_linear_infinite]"
                    alt="logo"
                />
            </Link>

            <div className="flex items-center justify-center gap-2 flex-grow">
                <Suspense>
                    <SpotifySearchBar isTopSide={false} />
                </Suspense>
                <AddArtist session={session} />
            </div>
            <div className="flex gap-2">
                <Login buttonStyles="" />
            </div>
        </nav>
    )
}
