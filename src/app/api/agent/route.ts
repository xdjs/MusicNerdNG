import { NextResponse } from "next/server";
import { searchForArtistByName } from "@/server/utils/queriesTS";

export async function POST(request: Request) {
  try {
    const { artist, question } = await request.json();

    if (!artist || !question) {
      return NextResponse.json({ error: "artist and question are required" }, { status: 400 });
    }

    const artists = await searchForArtistByName(artist as string);
    const found: any = artists[0];

    if (!found) {
      return NextResponse.json({ answer: "I couldn't find that artist in the database." });
    }

    const lowerQuestion = (question as string).toLowerCase();

    // Map of keywords to column names in the artists table
    const platformMap: Record<string, string> = {
      twitter: "x",
      x: "x",
      instagram: "instagram",
      youtube: "youtubechannel",
      youtubechannel: "youtubechannel",
      facebook: "facebook",
      tiktok: "tiktok",
      soundcloud: "soundcloud",
      bandcamp: "bandcamp",
    };

    let matchedColumn: string | null = null;
    for (const key of Object.keys(platformMap)) {
      if (lowerQuestion.includes(key)) {
        matchedColumn = platformMap[key];
        break;
      }
    }

    if (!matchedColumn) {
      return NextResponse.json({ answer: "Sorry, I don't understand the question yet." });
    }

    const value = found[matchedColumn] as string | null;

    if (!value) {
      return NextResponse.json({ answer: `I couldn't find a ${matchedColumn} link for ${found.name}.` });
    }

    // Format common platforms into full URLs when needed
    let url = value;
    if (matchedColumn === "x") {
      url = value.startsWith("http") ? value : `https://twitter.com/${value.replace(/^@/, "")}`;
    } else if (matchedColumn === "instagram") {
      url = value.startsWith("http") ? value : `https://instagram.com/${value.replace(/^@/, "")}`;
    } else if (matchedColumn === "youtubechannel") {
      url = value.startsWith("http")
        ? value
        : value.startsWith("@")
        ? `https://www.youtube.com/${value}`
        : `https://www.youtube.com/channel/${value}`;
    } else if (matchedColumn === "facebook") {
      url = value.startsWith("http") ? value : `https://facebook.com/${value}`;
    } else if (matchedColumn === "tiktok") {
      url = value.startsWith("http") ? value : `https://tiktok.com/@${value.replace(/^@/, "")}`;
    } else if (matchedColumn === "soundcloud") {
      url = value.startsWith("http") ? value : `https://soundcloud.com/${value}`;
    } else if (matchedColumn === "bandcamp") {
      url = value.startsWith("http") ? value : `https://${value}.bandcamp.com`;
    }

    return NextResponse.json({ answer: url });
  } catch (error) {
    console.error("[Agent] error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
} 