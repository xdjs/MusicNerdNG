"use client"

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ChatBubble from "./ChatBubble";
import { useRef, useState, useEffect } from "react";
import { aiChat, ChatMessage } from "@/server/utils/AiBro";
import { Artist } from "@/server/db/DbTypes";
import { Button } from "@/components/ui/button";
import { v4 as uuidv4 } from 'uuid';

export default function LLMChat({ artist }: { artist: Artist }) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState<string>("");
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [chatSessionId, setChatSessionId] = useState<string>("");
    
    // Generate a new chatSessionId on component mount
    useEffect(() => {
        setChatSessionId(uuidv4());
    }, []);

    const handleSendMessage = async (message: string) => {
        if (!message.trim() || isLoading) return;
        
        // Add the user message to the chat
        const updatedMessages = [
            ...messages, 
            { role: "user", parts: [{ text: message }] }
        ];
        setMessages(updatedMessages);
        setIsLoading(true);
        
        // Add a loading message from the assistant
        setMessages((current) => [
            ...current, 
            { role: "assistant", parts: [{ text: "" }] }
        ]);
        
        try {
            // Call aiChat with messages that don't include the loading message
            const response = await aiChat(
                message,
                updatedMessages, // Only includes messages up to and including the user's message
                chatSessionId,
                artist
            );
            
            // Replace the loading message with the actual response
            setMessages((current) => {
                const newMessages = [...current];
                // Replace the last message (loading) with the actual response
                newMessages[newMessages.length - 1] = { 
                    role: "assistant", 
                    parts: [{ text: response.response }] 
                };
                return newMessages;
            });
        } catch (error) {
            // Replace the loading message with an error message
            setMessages((current) => {
                const newMessages = [...current];
                // Replace the last message (loading) with the error message
                newMessages[newMessages.length - 1] = { 
                    role: "assistant", 
                    parts: [{ text: "Sorry, I couldn't process your request. Please try again." }] 
                };
                return newMessages;
            });
            console.error("Error getting AI response:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (chatWindowRef.current) {
            chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
        }
    }, [messages]);

    function mapMessages() {
        return messages.map((message, index) => (
            <ChatBubble 
                key={index} 
                message={message.parts[0].text} 
                isLoading={isLoading && index === messages.length - 1 && message.role === "assistant"} 
                isOutgoing={message.role === "user"} 
            />
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
            <Card className="w-[450px] h-[500px] flex max-w-full mt-auto flex-col">
                <CardContent className="flex-grow overflow-y-scroll scrollbar-hide pb-0 pt-4" ref={chatWindowRef}>
                    <ChatBubble message="I'm the Music Nerd, ask me about this artist! 🤓" isLoading={false} isOutgoing={false} />
                    {mapMessages()}
                </CardContent>
                <CardFooter>
                    <div className="p-3 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors duration-300 w-full">
                        <Input 
                            disabled={isLoading} 
                            value={input} 
                            onChange={(e) => setInput(e.target.value)} 
                            onKeyDown={(e) => handleLLMRequest(e.key)} 
                            className="focus:outline-none resize-none border-none bg-transparent p-0" 
                            placeholder="Ask a Music Nerd about this artist!" 
                        />
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}

