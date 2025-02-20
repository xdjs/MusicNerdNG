"use client"

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ChatBubble from "./ChatBubble";
import { useRef, useState, useEffect } from "react";
import getAiResponse from "@/server/utils/AiBro";
import { Artist } from "@/server/db/DbTypes";
import { Button } from "@/components/ui/button";

type Message = {
    message: string;
    isOutgoing: boolean;
    isLoading: boolean;
}

const initialMessages: Message[] = [
    { message: "I'm the Music Nerd, ask me about this artist! 🤓", isOutgoing: false, isLoading: false },
];

const loadingMessage = { message: "", isOutgoing: false, isLoading: true };

export default function LLMChat({ artist }: { artist: Artist }) {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [input, setInput] = useState<string>("");
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [response, setResponse] = useState<string>("");

    const handleSendMessage = async (message: string) => {
        setMessages((current) => [...current, { message, isOutgoing: true, isLoading: false }, loadingMessage]);
        setIsLoading(true);
        const response = await getAiResponse(`${message} use this artist info to help answer the question: ${JSON.stringify(artist)} be very casual and don't mention data in the response`);
        setMessages((current) => [...current.slice(0, current.length - 1), { message: response.response, isOutgoing: false, isLoading: false }]);
        setIsLoading(false);
    };


    useEffect(() => {
        if (chatWindowRef.current) {
            chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
        }
    }, [messages]);

    function mapMessages() {
        return messages.map((message, index) => (
            <ChatBubble key={index} message={message.message} isLoading={message.isLoading} isOutgoing={message.isOutgoing} />
        ));
    }

    function handleLLMRequest(key: string) {
        if (key === "Enter") {
            handleSendMessage(input);
            setInput("");
        }
    }

    return (
        <div className="h-full space-y-2">
            <img
                src="/musicNerdLogo.png"
                className="hidden md:block w-12 hover:animate-pulse drop-shadow-lg ml-auto"
                alt="logo"
            />
            <Card className="w-[400px] h-[520px] flex max-w-full mt-auto flex-col">
                <CardContent className="flex-grow overflow-y-scroll scrollbar-hide pb-0 pt-4" ref={chatWindowRef}>
                    {mapMessages()}
                </CardContent>
                <CardFooter>
                    <div className="p-3 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors duration-300 w-full">
                        <Input disabled={isLoading} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => handleLLMRequest(e.key)} className="focus:outline-none resize-none border-none bg-transparent p-0" placeholder="Ask a Music Nerd about this artist!" />
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}

