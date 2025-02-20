"use client"

import Link from "next/link"
import SearchBar from "./components/SearchBar"
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
        <nav className="p-2 sm:p-8  grow flex items-center">
            <Link href={"/"}>
                <img
                    src="/musicNerdLogo.png"
                    style={{
                        width: 'clamp(68px, calc(68px + (94 - 68) * ((100vw - 360px) / (1440 - 360))), 94px)'
                    }}
                    alt="logo"
                />
            </Link>
            <div className="pl-4 md:pl-10 SearchBar">
                <Suspense>
                    <SearchBar />
                </Suspense>
            </div>
                <div className="flex gap-2">
                    <AddArtist session={session} />
                    <Login buttonStyles="" />
                </div>
        </nav>
    )
}
