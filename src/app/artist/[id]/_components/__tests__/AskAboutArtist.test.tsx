// @ts-nocheck
/**
 * What an answer looks like once it is rendered.
 *
 * Every case here came from Pete reading a real answer on his phone: citation
 * markers sitting in the prose at full size doing nothing, "[Artist Doc]"
 * showing an internal label to a reader, records named and not linked, and
 * people named and linked inconsistently.
 */
import { jest } from "@jest/globals";
import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import AskAboutArtist from "../AskAboutArtist";

const ANSWER = {
    answer: 'Rango co-produced "crying on the floor (pete rango mix)" with Dame Atlas [Artist Doc, 2, 4] and has produced for Kilo Kish [10].',
    suggestions: [],
    sources: [
        { n: 2, title: "Cast Out Of Hell on Discogs", url: "https://www.discogs.com/release/1" },
        { n: 4, title: "crying on the floor — Spotify", url: "https://open.spotify.com/album/4Kka" },
        { n: 10, title: "Pete Rango on Instagram, 2026-03-23", url: "https://www.instagram.com/p/ABC/" },
    ],
    mentions: [
        { name: "Dame Atlas", instagram: "dameatlas", role: "artist" },
        { name: "Kilo Kish", artistId: "kilo-uuid" },
    ],
    songs: [{ title: "crying on the floor (pete rango mix)", spotifyUrl: "https://open.spotify.com/album/4Kka" }],
    bandcamp: "https://peterango.bandcamp.com",
    fromOpenWeb: false,
    webDomains: [],
};

function answerWith(overrides = {}) {
    return { ...ANSWER, ...overrides };
}

/** Ask a question and wait for the answer to land. */
async function ask(payload = ANSWER, trackLinks = []) {
    global.fetch = jest.fn(async (url) => {
        if (String(url).includes("/api/trackLinks")) {
            return { ok: true, json: async () => ({ links: trackLinks }) };
        }
        return { ok: true, json: async () => payload };
    });

    const { container } = render(<AskAboutArtist artistId="a1" artistName="Pete Rango" />);
    submit(container);
    // The answer is deliberately broken across elements — that is the whole
    // point of the renderer — so assert on the container's text, not on a node.
    await waitFor(() => expect(container.textContent).toMatch(/co-produced|mixed a record|recently/));
    return container;
}

/** The form submits on submit, not on a key press. */
function submit(container) {
    const input = screen.getByPlaceholderText(/Ask anything about Pete Rango/i);
    fireEvent.change(input, { target: { value: "Who has Pete Rango collaborated with?" } });
    fireEvent.submit(container.querySelector("form"));
}

describe("an answer, rendered", () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it("turns a citation number into a link to that source", async () => {
        // They were inert text at body size. Pete: "numbers for the sources
        // should be so big and should be hyperlinked... better if I could click
        // the hyperlink to the source where it's mentioned."
        await ask();
        // Inside the answer itself, not the summary list underneath — the point
        // is being able to click the source where the claim is made.
        const prose = within(screen.getByTestId("answer"));
        const two = prose.getByTitle("Cast Out Of Hell on Discogs");
        expect(two).toHaveAttribute("href", "https://www.discogs.com/release/1");
        expect(two).toHaveTextContent("2");
        expect(two.closest("sup")).not.toBeNull();   // small, not body size
        expect(prose.getByTitle("crying on the floor — Spotify")).toHaveAttribute("href", "https://open.spotify.com/album/4Kka");
    });

    it("drops [Artist Doc] instead of showing an internal label to a reader", async () => {
        // The artist doc is the one context block handed to the model
        // unnumbered, so it invents that marker. There is no source behind it
        // and never can be — the document has no public URL.
        const container = await ask();
        expect(container.textContent).not.toMatch(/Artist Doc/);
    });

    it("drops a citation number we have no source for", async () => {
        await ask(answerWith({
            answer: "He mixed a record [2] and another [99].",
            songs: [], mentions: [],
        }));
        const prose = within(screen.getByTestId("answer"));
        expect(prose.getByTitle("Cast Out Of Hell on Discogs")).toBeInTheDocument();
        expect(prose.queryByText("99")).not.toBeInTheDocument();
        // The whole bracket goes, not just the number inside it.
        expect(screen.getByTestId("answer").textContent).not.toMatch(/\[99\]/);
    });

    it("sends a collaborator already in the directory to their Music Nerd profile", async () => {
        // Pete: "if we bring up artists that are in our database, it should take
        // us to their Music Nerd profile."
        await ask();
        expect(screen.getByText("Kilo Kish").closest("a")).toHaveAttribute("href", "/artist/kilo-uuid");
    });

    it("sends one who is not to their Instagram, in a new tab", async () => {
        await ask();
        const dame = screen.getByText("Dame Atlas").closest("a");
        expect(dame).toHaveAttribute("href", "https://www.instagram.com/dameatlas/");
        expect(dame).toHaveAttribute("target", "_blank");
    });

    it("does not resolve a song's other services until the title is clicked", async () => {
        // Two provider lookups per song, on an answer naming three, is most of a
        // second added to every question for links most readers never open.
        await ask();
        const calls = () => (global.fetch as jest.Mock).mock.calls.map(c => String(c[0]));
        expect(calls().some(u => u.includes("/api/trackLinks"))).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: /crying on the floor/i }));
        await waitFor(() => expect(calls().some(u => u.includes("/api/trackLinks"))).toBe(true));
    });

    it("offers Spotify immediately and the rest once they resolve", async () => {
        await ask(ANSWER, [{ service: "Apple Music", url: "https://music.apple.com/us/album/x" }]);
        fireEvent.click(screen.getByRole("button", { name: /crying on the floor/i }));

        expect(screen.getByRole("link", { name: /Spotify/ })).toHaveAttribute("href", "https://open.spotify.com/album/4Kka");
        await waitFor(() => expect(screen.getByRole("link", { name: /Apple Music/ })).toHaveAttribute("href", "https://music.apple.com/us/album/x"));
    });

    it("closes on Escape and puts focus back on the title", async () => {
        // A click-outside handler alone leaves anyone on a keyboard stuck
        // inside the menu. And closing without restoring focus drops it to
        // <body>, which is worse than not opening the menu at all.
        await ask();
        fireEvent.click(screen.getByRole("button", { name: /crying on the floor/i }));
        expect(screen.getByRole("group", { name: /where to hear/i })).toBeInTheDocument();

        const title = screen.getByRole("button", { name: /crying on the floor/i });
        // Pointer clicks do not focus buttons in Safari/macOS. SongLink takes
        // focus explicitly so Escape still belongs to the menu just opened.
        expect(title).toHaveFocus();
        fireEvent.keyDown(title, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("group", { name: /where to hear/i })).not.toBeInTheDocument());
        expect(title).toHaveFocus();
    });

    it("Escape closes only the song menu that contains focus", async () => {
        // Keyboard activation does not fire the mousedown used by the
        // click-outside path, so two menus can legitimately be open. Their
        // document listeners must not both handle one Escape press.
        await ask(answerWith({
            answer: 'He recently released "First Song" and "Second Song".',
            sources: [],
            mentions: [],
            songs: [
                { title: "First Song", spotifyUrl: "https://open.spotify.com/album/first" },
                { title: "Second Song", spotifyUrl: "https://open.spotify.com/album/second" },
            ],
        }), [{ service: "Apple Music", url: "https://music.apple.com/us/album/x" }]);
        const first = screen.getByRole("button", { name: "First Song" });
        const second = screen.getByRole("button", { name: "Second Song" });
        fireEvent.click(first);
        fireEvent.click(second);
        expect(screen.getByRole("group", { name: /where to hear First Song/i })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: /where to hear Second Song/i })).toBeInTheDocument();
        // Let both async provider lookups settle before closing either menu.
        await waitFor(() => expect(screen.getAllByRole("link", { name: /Apple Music/ })).toHaveLength(2));

        second.focus();
        fireEvent.keyDown(second, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("group", { name: /where to hear Second Song/i })).not.toBeInTheDocument());
        expect(screen.getByRole("group", { name: /where to hear First Song/i })).toBeInTheDocument();
        expect(second).toHaveFocus();
    });

    it("gives a service with no icon a lettered chip rather than a broken image", async () => {
        // Apple Music has no file in public/siteIcons. A missing icon must read
        // as deliberate next to the others, not as a hole or a broken <img>.
        await ask(ANSWER, [{ service: "Apple Music", url: "https://music.apple.com/us/album/x" }]);
        fireEvent.click(screen.getByRole("button", { name: /crying on the floor/i }));

        const apple = await screen.findByRole("link", { name: /Apple Music/ });
        expect(apple.querySelector("img")).toBeNull();
        expect(apple.textContent).toContain("A");
    });

    it("still closes on a click elsewhere", async () => {
        // The mousedown path is untouched by the Escape work, but it is the
        // way most people close this and nothing was holding it.
        await ask();
        fireEvent.click(screen.getByRole("button", { name: /crying on the floor/i }));
        expect(screen.getByRole("group", { name: /where to hear/i })).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(screen.queryByRole("group", { name: /where to hear/i })).not.toBeInTheDocument());
    });

    it("calls Bandcamp the artist's page, because that is all it is", async () => {
        // Bandcamp has no API. Claiming this link is the RECORD would send a
        // fan to a store page for a different one.
        await ask();
        fireEvent.click(screen.getByRole("button", { name: /crying on the floor/i }));
        // The caveat is a second line under the icon now rather than one text
        // node, so assert the ACCESSIBLE NAME — what a reader actually gets —
        // instead of the markup that happens to carry it.
        // STRICT ABOUT THE BRACKETS. The old matcher allowed anything between
        // the two words, so it passed even when the accessible name collapsed
        // to "Bandcampartist page" with no boundary at all.
        const link = screen.getByRole("link", { name: /Bandcamp\s*\(artist page\)/i });
        expect(link).toHaveAttribute("href", "https://peterango.bandcamp.com");
    });

    it("keeps the song a plain button when the lookup fails", async () => {
        global.fetch = jest.fn(async (url) => {
            if (String(url).includes("/api/trackLinks")) throw new Error("offline");
            return { ok: true, json: async () => ANSWER };
        });
        const { container } = render(<AskAboutArtist artistId="a1" artistName="Pete Rango" />);
        submit(container);
        await waitFor(() => expect(container.textContent).toMatch(/co-produced/));

        fireEvent.click(screen.getByRole("button", { name: /crying on the floor/i }));
        // A failed lookup must not take away the link we already had.
        await waitFor(() => expect(screen.getByText("Spotify")).toBeInTheDocument());
    });

    it("says an answer came from the web when it did", async () => {
        await ask(answerWith({
            answer: "He co-produced a record recently.",
            sources: [], mentions: [], songs: [],
            fromOpenWeb: true, webDomains: ["stereogum.com"],
        }));
        expect(screen.getByText(/answered from the web/i)).toBeInTheDocument();
        expect(screen.getByText("stereogum.com")).toBeInTheDocument();
    });
});
