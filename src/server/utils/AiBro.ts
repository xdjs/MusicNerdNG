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
    temperature: .5,
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
                        Create a concise, engaging 20-second bio for ${artistName} covering:
                        - Background/origins: birthplace, formative experiences
                        - Artistic philosophy: core beliefs, representative quote
                        - Musical style: notable works, collaborations, milestones
                        - Online presence: website, social platforms, audience engagement
                        - Tone: professional yet inspiring, cohesive narrative
                        
                        Important: Write in plain text only. Do not include sound effects, stage directions, narrator indicators, 
                        asterisks, parenthetical notes like "(Sound fades in)" or similar formatting. The bio should be 
                        straightforward text that can be read directly without any special formatting or performance instructions.
                        `

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
