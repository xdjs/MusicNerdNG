"use server"

import { Artist } from "../db/DbTypes";

const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
});

const generationConfig = {
    temperature: 2,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 30,
    responseMimeType: "application/json",
    tools: [{ type: "google_search_retrieval" }],
};

const chatGenerationConfig = {
    temperature: 0.5,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 300,
};

type Response = {
    summary: string;
}

export type ChatMessage = {
    role: string;
    parts: { text: string }[];
}

type AiResponse = {
    response: string;
    history: ChatMessage[];
    isError: boolean;
}

// Add a simple in-memory cache for chat sessions
const chatSessions = new Map<string, {
  chat: any;
  lastAccessed: number;
}>();

export async function getAiBio(artistName?: string): Promise<AiResponse> {
    try {
        let prompt = `
                        Compose a professional and engaging short biography for music artist ${artistName}. 
                        The bio should present a well-rounded picture of the artist, 
                        covering the following key areas in a structured and narrative format:
                        Background and Origins: Begin by establishing the artist's background. 
                        Include details such as their place of birth or origin, any significant 
                        early life experiences that shaped their artistic path, 
                        and how these elements contribute to their identity as an artist. Be specific but concise.
                        Artistic Philosophy and Core Beliefs: Articulate the artist's underlying artistic philosophy. 
                        What are their core beliefs about creativity, music, and their role as an artist? If possible, 
                        subtly weave in a representative quote or statement that encapsulates their artistic ideals. 
                        Focus on the 'why' behind their art.
                        Musical Style and Key Works: Describe the artist's musical style in a way that is both informative 
                        and appealing to new listeners. Provide concrete examples of their notable musical works. 
                        Mention specific tracks, EPs, or albums that exemplify their style or represent milestones in their career. 
                        Include examples of collaborations with other artists if relevant, highlighting the diversity of their musical engagements.
                        Online Presence and Audience Engagement: Summarize how the artist connects with their audience online. 
                        Mention their official website and key social media platforms they utilize.
                         Describe the nature of their online engagement – is it resource-focused, personal, 
                         community-building, or primarily for music promotion? Be specific about the type of presence they maintain.
                        Overall Tone and Style: Maintain a professional and informative tone throughout the bio. 
                        While factual, the writing should also be engaging and slightly inspiring, 
                        aiming to pique the interest of readers who are new to the artist's work. 
                        Ensure the bio flows smoothly and reads as a cohesive narrative, rather than a collection of bullet points. 
                        Make sure that the bio is readable in less than 20 seconds`

        const result = await model.generateContent(prompt, generationConfig);
        return {
            response: result.response.text(),
            history: result.history,
            isError: false
        }
    } catch (error) {
        return {
            response: "",
            history: [],
            isError: true
        }
    }
}

export async function aiChat(message: string, history: ChatMessage[], sessionId: string, artist: Artist): Promise<AiResponse> {
    const prompt = `You are a music expert. You are given a music artist 
    name and a question about them. The name of the artist is ${artist.name}. 
    The question is ${message}. Be very casual keep the responses readable in less than 10 seconds`;
    
    try {
        // Check if we need to clean up (e.g., if we have too many sessions)
        if (chatSessions.size > 1000) {
            cleanupChatSessions();
        }
        
        let chat;
        
        // Check if we have an existing chat session
        if (chatSessions.has(sessionId)) {
            const session = chatSessions.get(sessionId)!;
            chat = session.chat;
            // Update last accessed timestamp
            session.lastAccessed = Date.now();
        } else {
            // Create a new chat session
            chat = model.startChat({
                generationConfig: chatGenerationConfig,
                history: history
            });
            // Store it for future use with timestamp
            chatSessions.set(sessionId, {
                chat: chat,
                lastAccessed: Date.now()
            });
        }
        
        // Send the new message
        const result = await chat.sendMessage(prompt);
        console.log(result.response.text());
        // Get updated history
        const updatedHistory = [...history, 
            { role: "user", parts: [{ text: message }] },
            { role: "model", parts: [{ text: result.response.text() }] }
        ];
        
        return {
            response: result.response.text(),
            history: updatedHistory,
            isError: false
        }
    } catch (error) {
        console.error("AI Chat error:", error);
        return {
            response: "",
            history: [],
            isError: true
        }
    }
}

// Function to clear chat sessions that haven't been used for a while
export async function cleanupChatSessions(maxAgeMs: number = 3600000) { // Default 1 hour
    const now = Date.now();
    let count = 0;
    
    chatSessions.forEach((session, id) => {
        if (now - session.lastAccessed > maxAgeMs) {
            chatSessions.delete(id);
            count++;
        }
    });
    
    console.log(`Cleaned up ${count} expired chat sessions`);
}
