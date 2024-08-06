import Link from "next/link"

export default function Nav() {
    return (
        <nav className="px-20 py-5 flex items-center gap-x-4">
            <Link href={"/"}>
                <img src="/musicNerdLogo.png" className="w-24" alt="logo" />
            </Link>
            <div className="grid nav-grid grow gap-x-4">
                <input type="text" />
                <button>Add Artist +</button>
                <button>Log In</button>
            </div>
        </nav>
    )
}