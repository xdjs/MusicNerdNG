export default function ChatBubble({ message, isOutgoing = false, isLoading = false }: { message: string, isOutgoing: boolean, isLoading: boolean }) {
    return (
        <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
            <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 ${isOutgoing
                        ? 'bg-pastyblue text-white rounded-br-none'
                        : 'bg-pastypink text-white rounded-bl-none'
                    }`}
            >
                {isLoading &&
                    <img
                        src="/musicNerdLogo.png"
                        className="w-8 animate-[spin_3s_linear_infinite]"
                        alt="logo"
                    />
                }
                <p className="text-sm">{message}</p>
            </div>
        </div>
    );
};
