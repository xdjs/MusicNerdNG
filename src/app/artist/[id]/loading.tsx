export default function Loading() {
    return (
        <div className="flex justify-center items-center min-h-[200px]">
            <img
                src="/musicNerdLogo.png"
                className="w-[100px] h-[100px] animate-[spin_3s_linear_infinite]"
                alt="logo"
            />
        </div>
    );
}