import Link from "next/link"
import SearchBar from "./components/SearchBar"
import Login from "./components/login"
import { Session } from "next-auth"
import AddArtist from "./components/AddArtist";

export default function Nav({ session }: { session: Session }) {
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
            <AddArtist pageProps={session}/>
            <Login pageProps={session} />
        </nav>
    )
}
