import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "@/env";

let _gemini: GoogleGenAI | null = null;

/** Lazily initialized so builds don't crash when GEMINI_API_KEY is missing */
export function getGemini(): GoogleGenAI {
    if (!_gemini) {
        if (!GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY must be set");
        }
        _gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    }
    return _gemini;
}

export const GEMINI_MODEL_PRO = "gemini-2.5-pro";
export const GEMINI_MODEL_FLASH = "gemini-2.5-flash";
