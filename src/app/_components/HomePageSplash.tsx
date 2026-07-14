"use client"

import ActivityFeed from "./ActivityFeed";

// The manifesto is the hero. Each line is a maroon statement with one keyword lifted into the
// identity pink (#ff9ce3) — the same pink as the wordmark, applied inline exactly as the app
// already does for it. globals.css defends `[style*="#ff9ce3"]` in dark mode, so the keywords and
// the wordmark stay pink in both themes while `text-maroon` flips to white around them.
const MANIFESTO: ReadonlyArray<{ before: string; keyword: string }> = [
    { before: "we listen with ", keyword: "intent" },
    { before: "we follow with ", keyword: "curiosity" },
    { before: "we care when artists let us into ", keyword: "the work" },
    { before: "we act with ", keyword: "purpose" },
];

const LINE_STYLE = {
    fontSize: 'clamp(24px, 4.2vw, 33px)',
    lineHeight: '1.38',
} as const;

const KEYWORD_STYLE = {
    color: '#ff9ce3',
    textShadow: '0 0 24px rgba(255, 156, 227, 0.35)',
} as const;

export default function HomePage() {
    return (
        <div className="px-6 sm:px-8 pt-0 pb-4 flex flex-col items-center w-full !flex-grow-0">
            <div className="w-full max-w-[800px]">
                {/* Wordmark — reduced from the production hero scale (was 32→84px) so the
                    manifesto leads. It stays recognizable but yields the top of the page. */}
                <div className="flex justify-center w-full px-4 pt-11">
                    <h1 className="lowercase font-bold"
                        style={{
                            fontSize: 'clamp(32px, calc(32px + (52 - 32) * ((100vw - 360px) / (1440 - 360))), 52px)',
                            letterSpacing: 'clamp(-1px, calc(-1px + (-2.5 - -1) * ((100vw - 360px) / (1440 - 360))), -2.5px)',
                            lineHeight: '1',
                            color: '#ff9ce3',
                            textShadow: '0 0 40px rgba(255, 156, 227, 0.25)',
                        }}
                    >
                        music nerd
                    </h1>
                </div>

                {/* Manifesto */}
                <div className="text-center lowercase pt-[26px] px-4 pb-1">
                    {MANIFESTO.map(({ before, keyword }) => (
                        <p key={keyword} className="font-bold text-maroon" style={LINE_STYLE}>
                            {before}
                            <span style={KEYWORD_STYLE}>{keyword}</span>.
                        </p>
                    ))}

                    <p className="font-semibold text-maroon text-[17px] mt-[18px]">
                        buy the music. follow the process. help make what comes next possible.
                    </p>
                </div>

                <ActivityFeed />
            </div>
        </div>
    );
}
