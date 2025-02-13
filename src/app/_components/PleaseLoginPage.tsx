import Login from "./nav/components/Login";

export default function PleaseLoginPage({text = "Login to access this page"}: {text?: string}) {
    return (
        <section className="px-10 py-5 space-y-6 flex items-center justify-center flex-col">
            <h1 className="text-2xl text-center font-bold">{text}</h1>
            <Login buttonStyles="w-full" />
        </section>
    )
}