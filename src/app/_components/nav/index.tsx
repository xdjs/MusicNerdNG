import Link from "next/link"
import SearchBar from "./components/SearchBar"
import AddArtist from "./components/AddArtist";
import Login from "@/app/_components/nav/components/Login";
import { getServerAuthSession } from "@/server/auth";
import LoginProviders from "./components/LoginProviders";

export default async function Nav() {
    const session = await getServerAuthSession();
    return (
        <nav className="nav-bar grow flex items-center">
            <Link href={"/"}>
                <img
                    src="/musicNerdLogo.png"
                    className="w-24"
                    alt="logo"
                />
            </Link>
            <div className="pl-4 md:pl-10 SearchBar">
                <SearchBar />
            </div>
            <LoginProviders>
                <div className="flex gap-2">
                    <AddArtist session={session} />
                    <Login buttonStyles="" />
                </div>
            </LoginProviders>
        </nav>
    )
}
