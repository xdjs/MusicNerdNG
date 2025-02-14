"use client"

import Link from "next/link"
import SearchBar from "./components/SearchBar"
import AddArtist from "./components/AddArtist";
import Login from "@/app/_components/nav/components/Login";
import { headers } from "next/headers";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { SessionProvider } from "next-auth/react";

export default function Wrapper() {
    return (
        <SessionProvider>
            <Nav />
        </SessionProvider>
    )
}

function Nav() {
    const { data: session } = useSession();
    const currentPath = usePathname();
    if (currentPath === "/") return null;
    return (
        <nav className="p-6 nav-bar flex items-center justify-between w-full">

            <Link href={"/"}>
                <img
                    src="/musicNerdLogo.png"
                    className="w-16"
                    alt="logo"
                />
            </Link>

            <div className="flex gap-2">
                <SearchBar />
                <AddArtist session={session} />
            </div>
            <div className="flex gap-2">
                <Login buttonStyles="" />
            </div>
        </nav>
    )
}
