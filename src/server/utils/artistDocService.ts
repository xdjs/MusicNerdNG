/**
 * The artist doc: a markdown knowledgebase compiled during post-claim onboarding.
 * Synthesis mandate is "mine, don't summarize" — see the design spec §7.
 * Both Gemini calls here are UNGROUNDED (no web search): sources + the artist's
 * own words are the entire input, which is what keeps the doc trustworthy.
 */
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import { getInterviewAnswers, getArtistDoc } from "@/server/utils/queries/onboardingQueries";
import { MAX_BIO_LENGTH } from "@/lib/bioConstants";

export const ARTIST_DOC_MAX_CHARS = 20_000;
export const ARTIST_DOC_CONTEXT_CAP = 8_000;
const GEMINI_TIMEOUT_MS = 20_000;

const DOC_SYSTEM_INSTRUCTION = (artistName: string) => `You compile an internal knowledge document about the music artist "${artistName}" for Music Nerd.
Output pure markdown. Use ONLY these section headers, in this order, and OMIT any section entirely if you have no real, specific material for it:
## Overview
## Sound
## Story hooks
## Currently
## Influences & comparables
## Connections
## Aesthetic & voice
## Discography highlights

Rules:
- Mine, don't summarize: prefer one specific, tellable detail over three generic facts.
- Name real people, places, songs, venues, and dates whenever the material supports them.
- INTERVIEW ANSWERS are the artist's own words — quote them verbatim in quotation marks, never paraphrase them.
- ## Story hooks: 2-5 bullet points, each one narratable specific a fan would repeat to a friend.
- ## Connections: real collaborators, producers, scenes, and influences named in the material — one short prose paragraph.
- Never fabricate. No placeholders, no "TBD", no empty sections, no hype words ("rising star", "eclectic", "undeniable").
- Target under 800 words total.`;

const ABOUT_SYSTEM_INSTRUCTION = (artistName: string) => `You write the public "About" for the music artist "${artistName}" from their knowledge document.
- 2-4 short paragraphs, roughly 600-1,200 characters. Plain text only — no markdown, no headers.
- Concrete and specific: names, places, songs, dates. Let specifics do the work, not adjectives.
- Where the document quotes the artist, keep the quote — their words beat your words.
- No hype phrases ("rising star", "eclectic", "undeniable", "pushing boundaries").
- Never fabricate anything not in the document.`;

function withGeminiTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), GEMINI_TIMEOUT_MS)),
    ]);
}

async function buildDocContext(artistId: string): Promise<{ artistName: string; context: string }> {
    const artist = await getArtistById(artistId);
    if (!artist) throw new Error(`Artist not found: ${artistId}`);
    const artistName = artist.name ?? "Unknown Artist";

    const parts: string[] = [];
    if (artist.spotify) parts.push(`Spotify (verified identity): https://open.spotify.com/artist/${artist.spotify}`);
    if (artist.instagram) parts.push(`Instagram: https://instagram.com/${artist.instagram}`);
    if (artist.x) parts.push(`X: https://x.com/${artist.x}`);
    if (artist.soundcloud) parts.push(`SoundCloud: ${artist.soundcloud}`);
    if (artist.youtube) parts.push(`YouTube: https://youtube.com/@${artist.youtube.replace(/^@/, "")}`);

    const sources = await getVaultSourcesByArtistId(artistId, "approved");
    if (sources.length > 0) {
        const sourceContext = sources.map(s => {
            const p = [`Source: ${s.title ?? s.url}`];
            if (s.snippet) p.push(s.snippet);
            if (s.extractedText) p.push(s.extractedText.slice(0, 2000));
            return p.join(" — ");
        }).join("\n");
        parts.push(`\n--- APPROVED SOURCES (about this exact artist) ---\n${sourceContext}\n--- END SOURCES ---`);
    }

    const answers = (await getInterviewAnswers(artistId)).filter(a => a.answer);
    if (answers.length > 0) {
        const interviewContext = answers.map(a => `Q: ${a.question}\nA (artist's own words): "${a.answer}"`).join("\n\n");
        parts.push(`\n--- INTERVIEW ANSWERS (quote verbatim) ---\n${interviewContext}\n--- END INTERVIEW ---`);
    }

    return { artistName, context: parts.join("\n") };
}

export async function synthesizeArtistDoc(artistId: string): Promise<string> {
    const { artistName, context } = await buildDocContext(artistId);
    const response = await withGeminiTimeout(
        getGemini().models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: context,
            config: {
                systemInstruction: DOC_SYSTEM_INSTRUCTION(artistName),
                temperature: 0.4,
            },
        })
    );
    const doc = response.text?.trim();
    if (!doc) throw new Error("Doc synthesis returned empty text");
    return doc.slice(0, ARTIST_DOC_MAX_CHARS);
}

export async function generateAboutFromDoc(artistName: string, docContent: string): Promise<string> {
    const response = await withGeminiTimeout(
        getGemini().models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: `ARTIST KNOWLEDGE DOCUMENT:\n${docContent}`,
            config: {
                systemInstruction: ABOUT_SYSTEM_INSTRUCTION(artistName),
                temperature: 0.5,
            },
        })
    );
    const about = response.text?.trim();
    if (!about) throw new Error("About generation returned empty text");
    return about.slice(0, MAX_BIO_LENGTH);
}

/** Capped doc slice for prompt injection (askArtist / funFacts / bio). Null when no doc. */
export async function getArtistDocContext(artistId: string): Promise<string | null> {
    const doc = await getArtistDoc(artistId);
    if (!doc?.content) return null;
    return doc.content.slice(0, ARTIST_DOC_CONTEXT_CAP);
}
