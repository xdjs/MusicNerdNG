import Link from "next/link"
import LoginBtn from "../buttons/LoginBtn"
import SearchBar from "../searchBar"

export default function Nav() {
    return (
        <nav className="px-10 grow py-5 flex items-center gap-x-4">
            <Link href={"/"}>
                <img src="/musicNerdLogo.png" className="w-24" alt="logo" />
            </Link>
            <div className="grid nav-grid grow gap-x-4 gap-y-4">
                <SearchBar/>
                <button className="pink-btn">Artist +</button>
                <LoginBtn/>
            </div>
        </nav>
    )
}