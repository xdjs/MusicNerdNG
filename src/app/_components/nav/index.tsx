import Link from "next/link"
import LoginBtn from "../buttons/LoginBtn"
import SearchBar from "../searchBar"

export default function Nav() {
    return (
        <nav className="nav-bar grow flex items-center">
            <Link href={"/"}>
                <img src="/musicNerdLogo.png" className="w-24" alt="logo" />
            </Link>
            <div className="grow"></div>
            {/* add nav-grid back in when login and add button implemented */}
            {/* <div className="grid nav-grid grow gap-x-4 gap-y-4">  */}
                <div className="SearchBar">
                    <SearchBar/>
                </div>
                {/* <button className="pink-btn">Artist +</button>
                <LoginBtn/> */}
            {/* </div> */}
        </nav>
    )
}