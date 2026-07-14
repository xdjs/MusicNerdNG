"use client"

import ActivityFeed from "./ActivityFeed";

// The manifesto is the hero. Each line is a maroon statement with one keyword lifted into the
// identity pink (#ff9ce3) — the same pink as the wordmark, applied inline exactly as the app
// already does for it. globals.css defends `[style*="#ff9ce3"]` in dark mode, so the keywords and
// the wordmark stay pink in both themes while `text-maroon` flips to white around them.
// The highlighted keyword can fall anywhere in the line, not just at the end.
const MANIFESTO: ReadonlyArray<{ before: string; keyword: string; after?: string }> = [
    { before: "we listen with ", keyword: "intent" },
    { before: "we follow with ", keyword: "curiosity" },
    { before: "we ", keyword: "care", after: " when artists let us into the work" },
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
                {/* Wordmark — trimmed from the production hero scale (was 32→84px) so the
                    manifesto leads, but kept large enough to still read as the wordmark.
                    Sits tight under the nav; the manifesto owns the vertical space below. */}
                <div className="flex justify-center w-full px-4 -mt-2">
                    <h1 className="lowercase font-bold"
                        style={{
                            fontSize: 'clamp(32px, calc(32px + (68 - 32) * ((100vw - 360px) / (1440 - 360))), 68px)',
                            letterSpacing: 'clamp(-1px, calc(-1px + (-3 - -1) * ((100vw - 360px) / (1440 - 360))), -3px)',
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
                    {MANIFESTO.map(({ before, keyword, after }) => (
                        <p key={keyword} className="font-bold text-maroon" style={LINE_STYLE}>
                            {before}
                            <span style={KEYWORD_STYLE}>{keyword}</span>
                            {after}
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
