/**
 * TS half of scripts/ingest-social.sh — do not run this directly, it expects
 * an already-resolved artist UUID (the .sh wrapper does name→uuid lookup and
 * the production-refusal guard). Invoked via `npx tsx scripts/ingest-social.ts`.
 *
 * Ingests an artist's Instagram feed (live via Apify, or from a local Apify
 * dataset JSON file with --from-file, which costs nothing and is instant —
 * use it to iterate on question quality without re-paying for a scrape),
 * then prints the derived signals and the generated grounded questions so
 * question quality can be reviewed without going through the onboarding UI.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";

const PRINT_LIMIT = 10;

/** Signals can legitimately contain hundreds of low-count entries (every
 *  one-off @mention on a busy artist's feed, for example) — print the top
 *  N per category instead of dumping the full array, or this becomes an
 *  unusable wall of JSON (and a SIGPIPE trap for anyone piping the output). */
function printCapped(label: string, items: unknown[]) {
    console.log(`\n${label} (${items.length} total, showing top ${Math.min(PRINT_LIMIT, items.length)}):`);
    console.log(JSON.stringify(items.slice(0, PRINT_LIMIT), null, 2));
    if (items.length > PRINT_LIMIT) console.log(`  ...${items.length - PRINT_LIMIT} more`);
}

function parseArgs(argv: string[]) {
    const [artistId, handle, ...rest] = argv;
    let limit: number | undefined;
    let fromFile: string | undefined;
    let max: number | undefined;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--limit") limit = Number(rest[++i]);
        else if (rest[i] === "--from-file") fromFile = rest[++i];
        else if (rest[i] === "--max") max = Number(rest[++i]);
    }
    return { artistId, handle, limit, fromFile, max };
}

async function main() {
    const { artistId, handle, limit, fromFile, max } = parseArgs(process.argv.slice(2));
    if (!artistId || !handle) {
        console.error("Usage: npx tsx scripts/ingest-social.ts <artist-uuid> <instagram-handle> [--limit N] [--from-file path] [--max N]");
        process.exit(1);
    }

    const { ingestInstagramPosts, ingestInstagramPostsFromItems, getSocialPostsForArtist } = await import("@/server/utils/socialIngest");
    const { deriveSocialSignals } = await import("@/server/utils/socialSignals");
    const { generateGroundedQuestions } = await import("@/server/utils/questionGenerator");
    const { getArtistById } = await import("@/server/utils/queries/artistQueries");

    console.log(`\n=== Ingesting @${handle} → artist ${artistId} ===`);
    const start = Date.now();
    let ingestResult;
    if (fromFile) {
        console.log(`Reading local Apify dataset from ${fromFile} (no Apify call, no cost)...`);
        const items = JSON.parse(fs.readFileSync(fromFile, "utf-8"));
        ingestResult = await ingestInstagramPostsFromItems(artistId, handle, items);
    } else {
        console.log(`Calling Apify (live, limit=${limit ?? 200})... this can take 1-5 minutes.`);
        ingestResult = await ingestInstagramPosts(artistId, handle, { limit });
    }
    console.log(`Ingest complete in ${Date.now() - start}ms:`, ingestResult);

    if (ingestResult.ingested === 0) {
        console.log("\nNo posts ingested — nothing to derive. Check APIFY_API_TOKEN / the handle / the file path.");
        process.exit(0);
    }

    const posts = await getSocialPostsForArtist(artistId);
    console.log(`\n=== Derived signals (from ${posts.length} stored posts) ===`);
    const artist = await getArtistById(artistId);
    const signals = deriveSocialSignals(posts, handle, artist?.name ?? undefined);
    printCapped("collaborators", signals.collaborators);
    printCapped("mentionedAccounts", signals.mentionedAccounts);
    printCapped("themes", signals.themes);
    printCapped("standoutPosts", signals.standoutPosts);
    printCapped("bursts", signals.bursts);
    printCapped("musicReferences", signals.musicReferences);

    console.log(`\n=== Generated grounded questions (max=${max ?? 6}) ===`);
    const questionsStart = Date.now();
    const questions = await generateGroundedQuestions(artistId, { max });
    console.log(`(${Date.now() - questionsStart}ms)`);
    if (questions.length === 0) {
        console.log("No questions generated — falls back to the static three onboarding questions.");
    } else {
        for (const q of questions) {
            console.log(`\n[${q.kind}] ${q.key}`);
            console.log(`  Q: ${q.question}`);
            console.log(`  why: ${q.rationale}`);
            console.log(`  sources: ${q.sourceUrls.join(", ")}`);
        }
    }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
