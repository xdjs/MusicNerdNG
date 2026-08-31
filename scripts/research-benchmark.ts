/**
 * Does a change to the research pipeline make it better or worse?
 *
 * Until now we answered that by running one artist and reading the output. That
 * is how a regression ships: you check the artist you were thinking about and
 * miss every other shape of failure.
 *
 * This resets a fixed set of artists to the state one actually arrives in — the
 * DSP ids MusicNerd creates them with, nothing else — runs discovery, and scores
 * the result against what we know to be true. It writes a report you can diff
 * against the last one.
 *
 *   npx tsx scripts/research-benchmark.ts              # every case
 *   npx tsx scripts/research-benchmark.ts pete dupes   # named cases
 *   npx tsx scripts/research-benchmark.ts --no-write   # don't save a report
 *
 * DEV ONLY. It deletes and rewrites artist state, so it refuses production.
 *
 * The ground truth below is hand-verified, not generated. Every handle was
 * checked against a live page; every forbidden host is a namesake this pipeline
 * has actually fallen for.
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { isBlockedSourceHost } from "../src/lib/sourceAuthority";
dotenv.config({ path: ".env.local" });

const PROD_REF = "cbabvmebugudeuylronz";

type Case = {
    key: string;
    id: string;
    name: string;
    /** Handles verified against a live page. The pipeline should find these. */
    /** Platform -> the handle we know is theirs, or several when more than one
     *  genuinely is. Black Dave MK2 runs both @blackdavemk2 and @blackdave.xyz
     *  and confirmed both; scoring one of them as a miss measured our
     *  preference, not his identity. The FIRST entry is the primary — the one
     *  a picker should default to — and any of them counts as correct. */
    expect: Record<string, string | string[]>;
    /** Left in place at reset — what an artist actually arrives holding. */
    seed: string[];
    /** Hosts that are a DIFFERENT subject. Any of these stored is a failure. */
    forbidHosts: string[];
    /** Handles belonging to somebody else — usually a namesake in our own directory. */
    forbidHandles?: Record<string, string[]>;
    note: string;
};

const CASES: Case[] = [
    {
        key: "pete",
        id: "50f23458-df64-4381-8042-7333e8b64531",
        name: "Pete Rango",
        seed: ["spotify", "deezer"],
        expect: {
            instagram: "p3t3rango", x: "p3t3rango", youtube: "peterango",
            soundcloud: "peterango", bandcamp: "peterango", twitch: "p3t3rango",
            facebook: "p3t3rango",
        },
        // "Rango" is a Hans Zimmer film soundtrack; "Pete" is Seeger and Murphy.
        forbidHosts: ["screenrant.com", "allmusic.com", "designingsound.org", "screenanarchy.com",
                      "shoutsmusic.blog", "genemyers.wordpress.com"],
        note: "Namesake-dense: a film soundtrack and two famous Petes.",
    },
    {
        key: "dupes",
        id: "ecba8cd6-ae0a-4ef5-9b11-5d5c10fce515",
        name: "Sherwinn Dupes Brice",
        seed: ["spotify", "deezer"],
        expect: {
            instagram: "dupesdidit", youtube: "dupesdidit", facebook: "dupesdidit",
            soundcloud: "dupesdidit", bandcamp: "dupes",
        },
        forbidHosts: ["thereader.com"], // a Lee Brice interview
        note: "Long tail. Handle is NOT derivable from his name — only his own site states it.",
    },
    {
        key: "pharaoh",
        id: "baa7dd84-772b-480a-83e7-114ae183eaf7",
        name: "Pharaoh Sistare",
        seed: ["deezer"],
        // Each verified against a live page title: "Pharaoh Sistare | Pop
        // Knight", "Pharaoh Sistare (@PharaohSistare) on X", "Strobe Light, by
        // Pharaoh Sistare". She has NO Twitch — twitch.tv/pharaohsistare returns
        // the bare string "Twitch" — and a run that gives her one is wrong.
        expect: {
            instagram: "pharaohsistare", x: "pharaohsistare", youtube: "pharaohsistare",
            soundcloud: "pharaohsistare", bandcamp: "pharaohsistare",
        },
        forbidHandles: { twitch: ["pharaohsistare"] },
        // A Finnish band, an unrelated "Pharaoh", and a different artist called Pharaoh Jo.
        forbidHosts: ["echoesanddust.com", "teethofthedivine.com", "medium.com"],
        note: "Thin coverage. The test is that thin does not become wrong.",
    },
    {
        key: "blackdave",
        id: "ffe3bc54-0b5a-41ff-8c1c-8bd303bba80e",
        name: "Black Dave",
        seed: ["spotify"],
        expect: {},
        // "Black Dave" reduces to the token "black". Chord DAVE is a DAC; Dave is
        // a UK rapper with Guardian coverage. Both reached a real artist's vault.
        forbidHosts: ["head-fi.org", "theguardian.com", "chordelectronics.co.uk", "whathifi.com"],
        // Two OTHER Black Daves are in our own directory. Their handles are not his.
        forbidHandles: {
            // Two OTHER Black Daves in this directory, plus black_davem — a
            // fourth account whose title also reads "Black Dave" and which is
            // not the one our records hold for him (blackdaveblackdave, whose
            // own title reads "blackdave"). On a cold start these are not
            // separable from outside, so taking any of them is a wrong link.
            instagram: ["blackdave.xyz", "blackdave", "black_davem"],
            youtube: ["blackdavemk2"], facebook: ["blackdavemk2", "blackdavenyc"],
            soundcloud: ["blackdavemk2", "blackdavenyc"], bandcamp: ["blackdavemk2"],
            twitch: ["black_davem"],
        },
        note: "Three Black Daves exist in this directory. Cross-contamination is the failure.",
    },
    {
        key: "mk2",
        id: "011645a7-a9c2-494c-a81f-2c10cdf1b756",
        name: "Black Dave MK2",
        seed: ["spotify", "deezer"],
        // NOT a standing miss any more, and the reason it looked like one was
        // wrong. This said his Instagram was "UNREACHABLE from outside" and
        // scored anything but blackdave.xyz as a failure. He runs BOTH
        // @blackdave.xyz (4,553 followers) and @blackdavemk2 (173) and
        // confirmed both, 8/31 — so the pipeline finding blackdavemk2 was never
        // a wrong link. It was us picking one of two real answers and throwing
        // the other away, which is the thing to fix in the product rather than
        // score as recall.
        //
        // x and twitch both confirmed his, same day. They were being found and
        // credited to nobody: absent from `expect` they scored nothing, and
        // absent from `forbidHandles` a wrong one would have scored nothing
        // either. A handle the benchmark cannot see is a handle it cannot
        // defend.
        //
        // Worth knowing about twitch=BlackDave: nothing on that page says whose
        // it is ("blackdave - Twitch", no name text). It arrived by propagating
        // his confirmed X handle on the strength of an og:image alone, on a
        // name three artists in this directory share. It is right, and it was
        // not reasoned to — do not read this passing as evidence that rule is
        // sound.
        expect: { instagram: ["blackdave.xyz", "blackdavemk2"], x: "BlackDave", twitch: "BlackDave" },
        forbidHosts: ["head-fi.org", "theguardian.com", "chordelectronics.co.uk", "whathifi.com",
                      "thrashermagazine.com", "quartersnacks.com"], // the OTHER Black Dave's skate press
        // The sharpest case in the set: same name as two other artists we hold.
        forbidHandles: {
            instagram: ["blackdaveblackdave", "blackdave", "black_davem"],
            x: ["blackdavenyc"], soundcloud: ["blackdaveblackdave", "blackdavenyc"],
            bandcamp: ["black-dave"], twitch: ["black_davem"],
        },
        note: "Must not inherit the skater-rapper Black Dave's press or handles. Runs two Instagrams; both are his.",
    },
];

type Score = {
    case: string; name: string;
    linksCorrect: string[]; linksWrong: string[]; linksMissed: string[];
    sourcesKept: number; sourcesForbidden: string[]; sourcesBlocked: string[];
    /** How many the FIRST half found, so a regression is attributable. */
    profileLinks: number;
    seconds: number;
};

async function main() {
    const args = process.argv.slice(2);
    const write = !args.includes("--no-write");
    // --blank also clears the DSP ids, which the normal run seeds. It is the
    // hardest configuration the pipeline can face: no identifier to match
    // MusicBrainz on, no Spotify catalogue to corroborate against, nothing but
    // a name. It is also exactly what an onboarding demo reset to "blank"
    // leaves behind, so it is worth being able to measure rather than hope.
    const blank = args.includes("--blank");
    const wanted = args.filter(a => !a.startsWith("--"));
    const cases = wanted.length ? CASES.filter(c => wanted.includes(c.key)) : CASES;
    if (!cases.length) { console.error(`No case matched. Known: ${CASES.map(c => c.key).join(", ")}`); process.exit(1); }

    if ((process.env.SUPABASE_DB_CONNECTION ?? "").includes(PROD_REF)) {
        console.error("REFUSING: SUPABASE_DB_CONNECTION points at production.");
        process.exit(1);
    }

    const { db } = await import("@/server/db/drizzle");
    const { sql } = await import("drizzle-orm");
    const { searchAndPopulateVault } = await import("@/server/utils/queries/vaultWebSearch");
    // THE FLOW AN ARTIST ACTUALLY RUNS, not one component of it.
    //
    // This called searchAndPopulateVault and nothing else, while onboarding
    // runs profile discovery FIRST and writes what it finds, then searches for
    // sources. So the benchmark scored half the pipeline and I quoted it as the
    // product's number for days: measured on Pete Rango from a cold start,
    // vault search alone finds 3 of 7 handles and profile discovery finds 7 of
    // 7 in five seconds. A change to the component doing most of the work could
    // not have moved this gate at all, which is worse than a noisy gate.
    const { discoverArtistProfilesStream } = await import("@/server/utils/profileDiscovery");
    const { applyProfileLinkDecisions } = await import("@/server/utils/onboarding/turnHandlers");

    const ALL = ["instagram", "x", "youtube", "tiktok", "facebook", "soundcloud", "bandcamp", "twitch"];
    const scores: Score[] = [];

    for (const c of cases) {
        // Reset to the state an artist actually arrives in: the DSP ids and
        // nothing else. Anything the pipeline ends up holding, it found.
        // Every column a seed can name, so `seed` actually means what it says.
        // ALL held only the social platforms, and spotify/deezer are never in
        // it — so filtering ALL by the seed never cleared either DSP id, and a
        // case declared "deezer only" ran with its Spotify id still present.
        // MusicBrainz's identifier path then used evidence the scenario says is
        // absent, and every such case scored better than the situation it was
        // supposed to be measuring.
        const RESETTABLE = [...ALL, "spotify", "deezer"];
        const clear = blank ? RESETTABLE : RESETTABLE.filter(p => !c.seed.includes(p));
        // The DSP ids are the artist's real identifiers and are not ours to
        // lose. Captured before clearing and put back after, whenever either is
        // being cleared — not only in --blank, now that a normal run can clear
        // them too.
        const clearsDsp = clear.includes("spotify") || clear.includes("deezer");
        const dsp: any = clearsDsp
            ? await db.execute(sql.raw(`select spotify, deezer from artists where id = '${c.id}'`))
            : null;
        const dspRow = dsp ? ((dsp.rows ?? dsp)[0] ?? {}) : null;
        await db.execute(sql.raw(
            `update artists set ${clear.map(p => `${p} = null`).join(", ")} where id = '${c.id}'`));
        await db.execute(sql`delete from artist_vault_sources where artist_id = ${c.id}::uuid`);

        const started = Date.now();

        // 1 — profile discovery, and writing what it finds. The order and the
        // calls mirror the auto-build in turnHandlers; if that changes, this
        // has to change with it or the gate stops describing the product.
        const discovered: any[] = [];
        let provisionalSiteNames: string[] = [];
        try {
            for await (const event of discoverArtistProfilesStream(c.id)) {
                if (event.kind === "found") discovered.push(event.profile);
            }
            if (discovered.length > 0) {
                // verifyIdentity mirrors the auto-build. Without it this ran
                // the unguarded path and reported wrong links that the product
                // does not actually write — a gate that lies in the other
                // direction is no better than one that lies in this one.
                // ONE WRITE PER PLATFORM, mirroring the auto-build. Discovery
                // returns up to two accounts per platform now; handing both to
                // applyProfileLinkDecisions lets the LAST one win, which is the
                // silent arbitrary pick the product no longer makes. The
                // alternative is a question for the artist, and a benchmark run
                // has nobody to ask — so it scores the primary, same as an
                // artist who closes the tab before answering.
                const seenPlatform = new Set<string>();
                const primaries = discovered.filter(p => {
                    if (seenPlatform.has(p.siteName)) return false;
                    seenPlatform.add(p.siteName);
                    return true;
                });
                const outcome = await applyProfileLinkDecisions(
                    c.id, primaries.map(p => ({ url: p.profileUrl })), [], { verifyIdentity: true });
                const wrote = new Set(outcome.written);
                provisionalSiteNames = [...new Set(
                    primaries.filter(p => p.provisional && wrote.has(p.siteName)).map(p => p.siteName),
                )];
                const alternatives = discovered.length - primaries.length;
                if (alternatives > 0) console.log(`  [${c.key}] ${alternatives} second account(s) offered as a choice, not scored`);
            }
        } catch (e: any) {
            console.error(`  [${c.key}] profile discovery threw:`, e?.message);
        }
        // Scored separately so a regression can be attributed to the half that
        // caused it rather than to "discovery".
        const afterProfiles: any = await db.execute(sql.raw(
            `select ${ALL.join(", ")} from artists where id = '${c.id}'`));
        const profileLinks = Object.entries(c.expect).filter(([platform, want]) => {
            const got = String((afterProfiles.rows ?? afterProfiles)[0]?.[platform] ?? "").toLowerCase();
            return !!got && (Array.isArray(want) ? want : [want]).some(w => w.toLowerCase() === got);
        }).length;

        // 2 — sources, and the handle propagation that rides along with them.
        // `provisionalSiteNames` mirrors the auto-build too: without it the
        // search skips every column discovery guessed into, which is the
        // ordering defect this gate exists to catch.
        await searchAndPopulateVault(c.id, { provisionalSiteNames })
            .catch(e => console.error(`  [${c.key}] vault search threw:`, e?.message));
        const seconds = Math.round((Date.now() - started) / 100) / 10;

        const after: any = await db.execute(sql.raw(
            `select ${ALL.join(", ")} from artists where id = '${c.id}'`));

        if (dspRow) {
            await db.execute(sql`update artists set spotify = ${dspRow.spotify ?? null}, deezer = ${dspRow.deezer ?? null} where id = ${c.id}::uuid`);
        }
        const links = (after.rows ?? after)[0] ?? {};

        const linksCorrect: string[] = [], linksWrong: string[] = [], linksMissed: string[] = [];
        for (const [platform, want] of Object.entries(c.expect)) {
            const accepted = Array.isArray(want) ? want : [want];
            const got = links[platform];
            if (!got) linksMissed.push(`${platform}=${accepted[0]}`);
            else if (accepted.some(w => String(got).toLowerCase() === w.toLowerCase())) linksCorrect.push(`${platform}=${got}`);
            else linksWrong.push(`${platform}=${got} (want ${accepted.join(" or ")})`);
        }
        // Somebody else's handle is worse than a missing one — and it is ONE
        // wrong platform, not two. A handle that both differs from the expected
        // value and appears in forbidHandles was already recorded by the loop
        // above, and pushing it again double-counted exactly the namesake case
        // this benchmark exists to measure, inflating every total it reported.
        const wrongPlatforms = new Set(linksWrong.map(w => w.split("=")[0]));
        for (const [platform, bad] of Object.entries(c.forbidHandles ?? {})) {
            const got = links[platform];
            if (!got || !bad.some(b => b.toLowerCase() === String(got).toLowerCase())) continue;
            if (wrongPlatforms.has(platform)) {
                // Already counted; say WHY it is wrong rather than counting twice.
                const at = linksWrong.findIndex(w => w.startsWith(`${platform}=`));
                linksWrong[at] += " — belongs to another artist";
                continue;
            }
            linksWrong.push(`${platform}=${got} (belongs to another artist)`);
            wrongPlatforms.add(platform);
        }

        const srcs: any = await db.execute(sql`
            select url from artist_vault_sources where artist_id = ${c.id}::uuid`);
        const urls = (srcs.rows ?? srcs).map((r: any) => String(r.url));
        const sourcesForbidden = urls.filter((u: string) => c.forbidHosts.some(h => u.includes(h)));
        // Read from the pipeline's own list rather than restated here, so the
        // benchmark cannot pass while the two drift apart. A blocked host is a
        // different failure from a namesake: the page is really about the
        // artist, and it still should not be on their page.
        const sourcesBlocked = urls.filter((u: string) => isBlockedSourceHost(u));

        scores.push({ case: c.key, name: c.name, linksCorrect, linksWrong, linksMissed,
                      profileLinks, sourcesKept: urls.length, sourcesForbidden, sourcesBlocked, seconds });

        const want = Object.keys(c.expect).length;
        console.log(`\n${c.name}  (${seconds}s)`);
        console.log(`  links     ${linksCorrect.length}/${want} correct   (profile discovery found ${profileLinks}, source search added ${linksCorrect.length - profileLinks})` +
                    `${linksWrong.length ? `, ${linksWrong.length} WRONG` : ""}` +
                    `${linksMissed.length ? `, ${linksMissed.length} missed` : ""}`);
        if (linksWrong.length) for (const w of linksWrong) console.log(`              ! ${w}`);
        if (linksMissed.length) console.log(`              missed: ${linksMissed.join(", ")}`);
        console.log(`  sources   ${urls.length} kept` +
                    `${sourcesForbidden.length ? `, ${sourcesForbidden.length} NAMESAKE` : ""}`);
        if (sourcesForbidden.length) for (const s of sourcesForbidden) console.log(`              ! ${s.slice(0, 80)}`);
        if (sourcesBlocked.length) for (const s of sourcesBlocked) console.log(`              ! BLOCKED HOST ${s.slice(0, 70)}`);
    }

    // ---- totals -------------------------------------------------------
    const t = scores.reduce((a, s) => ({
        correct: a.correct + s.linksCorrect.length,
        wrong: a.wrong + s.linksWrong.length,
        missed: a.missed + s.linksMissed.length,
        sources: a.sources + s.sourcesKept,
        bad: a.bad + s.sourcesForbidden.length,
        blocked: a.blocked + s.sourcesBlocked.length,
    }), { correct: 0, wrong: 0, missed: 0, sources: 0, bad: 0, blocked: 0 });
    const wanted_ = t.correct + t.missed + scores.reduce((a, s) => a + s.linksWrong.filter(w => w.includes("want")).length, 0);

    console.log(`\n${"=".repeat(58)}`);
    console.log(`links    ${t.correct} correct   ${t.wrong} wrong   ${t.missed} missed   (of ${wanted_} known)`);
    console.log(`sources  ${t.sources} kept      ${t.bad} namesake   ${t.blocked} blocked-host`);
    console.log(`${"=".repeat(58)}`);
    console.log(t.wrong === 0 && t.bad === 0 && t.blocked === 0
        ? "No wrong links, no namesakes, no scrape farms. Misses are recall; those are correctness."
        : "CORRECTNESS FAILURE — a wrong link, a namesake, or a blocked host is worse than a gap.");

    if (write) {
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const day = new Date().toISOString().slice(0, 10);
        const dir = path.join(process.cwd(), "docs/rnd/benchmarks");
        fs.mkdirSync(dir, { recursive: true });
        const lines = [
            `# Research benchmark — ${stamp}`, "",
            `| artist | links correct | wrong | missed | sources | namesake | blocked | secs |`,
            `|---|---|---|---|---|---|---|---|`,
            ...scores.map(s => `| ${s.name} | ${s.linksCorrect.length} | ${s.linksWrong.length} | ${s.linksMissed.length} | ${s.sourcesKept} | ${s.sourcesForbidden.length} | ${s.sourcesBlocked.length} | ${s.seconds} |`),
            "", `**Totals** — ${t.correct} correct, ${t.wrong} wrong, ${t.missed} missed of ${wanted_} known handles; ${t.sources} sources, ${t.bad} namesake, ${t.blocked} blocked-host.`, "",
            ...scores.flatMap(s => [
                `## ${s.name}`,
                s.linksCorrect.length ? `- found: ${s.linksCorrect.join(", ")}` : "- found: none",
                s.linksMissed.length ? `- missed: ${s.linksMissed.join(", ")}` : "",
                s.linksWrong.length ? `- **WRONG**: ${s.linksWrong.join(", ")}` : "",
                s.sourcesForbidden.length ? `- **NAMESAKE SOURCES**: ${s.sourcesForbidden.join(", ")}` : "",
                s.sourcesBlocked.length ? `- **BLOCKED HOSTS**: ${s.sourcesBlocked.join(", ")}` : "",
                "",
            ].filter(Boolean)),
        ];
        const file = path.join(dir, `${day}.md`);
        fs.writeFileSync(file, lines.join("\n"));
        console.log(`\nreport -> docs/rnd/benchmarks/${day}.md`);
    }
    process.exit(t.wrong === 0 && t.bad === 0 && t.blocked === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
