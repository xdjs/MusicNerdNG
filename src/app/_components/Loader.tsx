export default function Loader() {
    return (
        <div className="flex justify-center items-center h-full grow">
            <img
                src="/musicNerdLogo.png"
                className="w-[200px] h-[200px] animate-[spin_3s_linear_infinite]"
                alt="logo"
            />
            <h1 className="text-2xl font-bold"></h1>
        </div>
    );
}