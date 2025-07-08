"use server";

import axios from "axios";
import { DISCORD_WEBHOOK_URL } from "@/env";

/**
 * Sends a plain text message to the configured Discord webhook.
 */
export async function sendDiscordMessage(message: string) {
    const discordWebhookUrl = DISCORD_WEBHOOK_URL;
    if (!discordWebhookUrl) return;

    try {
        await axios.post(discordWebhookUrl, { content: message });
    } catch (e) {
        console.error("[sendDiscordMessage] Error sending Discord message", e);
    }
} 