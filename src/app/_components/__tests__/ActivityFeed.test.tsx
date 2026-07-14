// @ts-nocheck
import { jest } from "@jest/globals";
import React from "react";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";

// Mock next/link as a simple anchor
jest.mock("next/link", () => ({
    __esModule: true,
    default: ({ href, children, ...props }) =>
        <a href={href} {...props}>{children}</a>,
}));

const mockEvents = [
    { type: "agent_mapping", artistId: "a1", artistName: "Mogwai", platform: "deezer", createdAt: "2026-03-27T12:00:00Z" },
    { type: "ugc_approved", artistId: "a2", artistName: "SENTO", platform: "youtube", createdAt: "2026-03-27T11:55:00Z" },
    { type: "artist_added", artistId: "a3", artistName: "Taylor Swift", platform: null, createdAt: "2026-03-27T11:00:00Z" },
];

// Static import of ActivityFeed — no resetModules needed since the component
// has no module-level side effects that require re-initialization.
import ActivityFeed from "../ActivityFeed";

describe("ActivityFeed", () => {
    beforeEach(() => {
        (global.fetch as jest.Mock).mockReset();
    });

    afterEach(cleanup);

    it("shows empty state before data loads", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [],
        });

        await act(async () => { render(<ActivityFeed />); });

        expect(screen.getByText("Waiting for activity...")).toBeTruthy();
    });

    it("renders events after initial fetch", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockEvents,
        });

        await act(async () => { render(<ActivityFeed />); });

        await waitFor(() => {
            expect(screen.getByText("Mogwai")).toBeTruthy();
            expect(screen.getByText("SENTO")).toBeTruthy();
            expect(screen.getByText("Taylor Swift")).toBeTruthy();
        });
    });

    it("renders artist names as links to artist pages", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockEvents,
        });

        await act(async () => { render(<ActivityFeed />); });

        await waitFor(() => {
            const links = screen.getAllByRole("link");
            expect(links.some((l) => l.getAttribute("href") === "/artist/a1")).toBe(true);
            expect(links.some((l) => l.getAttribute("href") === "/artist/a3")).toBe(true);
        });
    });

    it("shows live indicator", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [],
        });

        await act(async () => { render(<ActivityFeed />); });

        expect(screen.getByText("Live")).toBeTruthy();
    });

    it("has aria-live region for accessibility", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockEvents,
        });

        await act(async () => { render(<ActivityFeed />); });

        await waitFor(() => {
            const list = screen.getByRole("list");
            expect(list.getAttribute("aria-live")).toBe("polite");
            expect(list.getAttribute("aria-label")).toBe("Recent activity");
        });
    });

    it("has aria-live region even when empty", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [],
        });

        await act(async () => { render(<ActivityFeed />); });

        const list = screen.getByRole("list");
        expect(list.getAttribute("aria-live")).toBe("polite");
    });

    it("handles fetch failure gracefully", async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

        await act(async () => { render(<ActivityFeed />); });

        expect(screen.getByText("Waiting for activity...")).toBeTruthy();
    });

    // The endpoint returns more rows than the homepage shows. The cap used to be applied only on
    // the poll path, so the first paint rendered everything the API returned — and because the row
    // count drives the opacity ramp, an uncapped list also flattened the fade.
    it("caps the initial load to 4 rows even when the endpoint returns more", async () => {
        const many = Array.from({ length: 9 }, (_, i) => ({
            type: "artist_added",
            artistId: `id${i}`,
            artistName: `Artist ${i}`,
            platform: null,
            createdAt: `2026-03-27T12:0${i}:00Z`,
        }));

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => many,
        });

        await act(async () => { render(<ActivityFeed />); });

        await waitFor(() => {
            expect(screen.getByText("Artist 0")).toBeTruthy();
        });

        const rows = screen.getByRole("list").querySelectorAll("li");
        expect(rows.length).toBe(4);

        // The newest four are kept, in order; the rest are dropped.
        expect(screen.getByText("Artist 3")).toBeTruthy();
        expect(screen.queryByText("Artist 4")).toBeNull();
        expect(screen.queryByText("Artist 8")).toBeNull();
    });

    it("fades rows down the list: 1, 0.82, 0.63, 0.45", async () => {
        const four = Array.from({ length: 4 }, (_, i) => ({
            type: "artist_added",
            artistId: `id${i}`,
            artistName: `Artist ${i}`,
            platform: null,
            createdAt: `2026-03-27T12:0${i}:00Z`,
        }));

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => four,
        });

        await act(async () => { render(<ActivityFeed />); });

        await waitFor(() => {
            expect(screen.getByText("Artist 0")).toBeTruthy();
        });

        const rows = [...screen.getByRole("list").querySelectorAll("li")];
        expect(rows.map((r) => r.style.opacity)).toEqual(["1", "0.82", "0.63", "0.45"]);
    });

    it("does not divide by zero when only one row is returned", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [mockEvents[0]],
        });

        await act(async () => { render(<ActivityFeed />); });

        await waitFor(() => {
            expect(screen.getByText("Mogwai")).toBeTruthy();
        });

        const rows = [...screen.getByRole("list").querySelectorAll("li")];
        expect(rows).toHaveLength(1);
        expect(rows[0].style.opacity).toBe("1");
    });
});
