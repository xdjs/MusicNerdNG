"use server"


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
};

type Response = {
    summary: string;
}

type AiResponse = {
    response: string;
    history: string[];
    isError: boolean;
}

async function getAiResponse(prompt: string): Promise<AiResponse> {
    try {
        const result = await model.generateContent(prompt);
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

export default getAiResponse;
