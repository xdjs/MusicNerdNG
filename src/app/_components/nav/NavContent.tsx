"use client"

import Link from "next/link"
import SearchBar from "./components/SearchBar"
import AddArtist from "./components/AddArtist";
import Login from "./components/Login";
import { Suspense } from "react";

export default function NavContent() {
    return (
        <nav className="w-full px-3 py-3 sm:p-6 nav-bar flex items-center justify-between gap-2 max-w-[1000px] mx-auto">
            <div className="flex gap-2 shrink-0">
                <Link href={"/"}>
                    <img
                        src="/icon.ico"
                        width={64}
                        height={64}
                        className="w-10 h-10 sm:w-16 sm:h-16 hover:animate-[spin_3s_linear_infinite]"
                        alt="logo"
                    />
                </Link>
            </div>

            <div className="flex items-center justify-center gap-2 flex-grow min-w-0">
                <Suspense>
                    <SearchBar />
                </Suspense>
                <AddArtist />
            </div>
            <div className="flex gap-2 items-center shrink-0">
                <Login buttonStyles="" />
            </div>
        </nav>
    )
}
