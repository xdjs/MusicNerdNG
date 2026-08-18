/**
 * Transactional email via the Resend HTTP API — deliberately no SDK dependency.
 * Ops prerequisite: verify the sending domain (musicnerd.xyz) in the Resend
 * dashboard DNS settings before production sends will deliver.
 */
import { RESEND_API_KEY, NEXTAUTH_URL } from "@/env";

const FROM_ADDRESS = "Music Nerd <no-reply@musicnerd.xyz>";
const BASE_URL = NEXTAUTH_URL || "https://www.musicnerd.xyz";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<boolean> {
    if (!RESEND_API_KEY) {
        console.log("[email] RESEND_API_KEY not set — skipping send to", input.to);
        return false;
    }
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: FROM_ADDRESS,
                to: [input.to],
                subject: input.subject,
                html: input.html,
            }),
        });
        if (!res.ok) {
            console.error(`[email] Resend send failed: ${res.status} ${await res.text().catch(() => "")}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error("[email] Send error:", e);
        return false;
    }
}

export function claimApprovedEmailHtml(artistName: string | null, artistId: string): string {
    const url = `${BASE_URL}/artist/${artistId}`;
    // `artistName` is null when the artist record couldn't be looked up — degrade
    // to generic-but-grammatical copy instead of interpolating a placeholder like
    // "your artist" into "You now manage your artist on Music Nerd."
    const manageLine = artistName
        ? `You now manage <strong>${escapeHtml(artistName)}</strong> on Music Nerd.`
        : `You now manage your artist profile on Music Nerd.`;
    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111;">
  <h1 style="font-size: 22px; margin: 0 0 12px;">Your profile is approved 🎉</h1>
  <p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
    ${manageLine} Take two minutes to finish
    setting up — confirm your links, tell us your story, and publish your About page.
  </p>
  <a href="${url}" style="display: inline-block; background: #ff4b84; color: #fff; text-decoration: none; font-weight: 600; padding: 12px 24px; border-radius: 10px; font-size: 15px;">
    Finish setting up your profile
  </a>
  <p style="font-size: 12px; color: #888; margin: 24px 0 0;">
    What you add helps Music Nerd tell your story to fans.
  </p>
</div>`;
}

export async function sendClaimApprovedEmail(to: string, artistName: string | null, artistId: string): Promise<boolean> {
    return sendEmail({
        to,
        subject: artistName
            ? `Your ${artistName.replace(/[\r\n]+/g, " ")} profile on Music Nerd is approved 🎉`
            : `Your Music Nerd profile is approved 🎉`,
        html: claimApprovedEmailHtml(artistName, artistId),
    });
}
