// @ts-nocheck
import { jest } from '@jest/globals';

describe('fetchLinkPreview', () => {
    const realFetch = global.fetch;

    afterEach(() => {
        global.fetch = realFetch;
        jest.resetModules();
    });

    it('returns nulls for an unsafe URL and never calls fetch (SSRF guard fires before any network attempt)', async () => {
        global.fetch = jest.fn();
        const { fetchLinkPreview } = await import('../linkPreview');
        const result = await fetchLinkPreview('http://169.254.169.254/latest/meta-data');
        expect(result).toEqual({ imageUrl: null, title: null });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never throws on a rejected fetch — resolves to nulls instead', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
        const { fetchLinkPreview } = await import('../linkPreview');
        await expect(fetchLinkPreview('https://example.com/artist')).resolves.toEqual({ imageUrl: null, title: null });
    });

    it('never throws when fetch resolves but the body cannot be parsed as expected', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.reject(new Error('bad json')),
            text: () => Promise.reject(new Error('bad text')),
        }));
        const { fetchLinkPreview } = await import('../linkPreview');
        await expect(fetchLinkPreview('https://example.com/artist')).resolves.toEqual({ imageUrl: null, title: null });
    });

    it('prefers the Spotify oEmbed thumbnail_url/title when the endpoint succeeds', async () => {
        global.fetch = jest.fn((url: string) => {
            expect(url).toContain('open.spotify.com/oembed?url=');
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    thumbnail_url: 'https://i.scdn.co/image/abc123',
                    title: 'Nova Reyes',
                }),
            });
        });
        const { fetchLinkPreview } = await import('../linkPreview');
        const result = await fetchLinkPreview('https://open.spotify.com/artist/spot1');
        expect(result).toEqual({ imageUrl: 'https://i.scdn.co/image/abc123', title: 'Nova Reyes' });
        expect(global.fetch).toHaveBeenCalledTimes(1); // oEmbed succeeded — no scrape fallback needed
    });

    it('falls back to scraping og:image/og:title when Spotify oEmbed has no thumbnail', async () => {
        global.fetch = jest.fn((url: string) => {
            if (url.includes('oembed')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ title: 'Nova Reyes' }) });
            }
            return Promise.resolve({
                ok: true,
                text: () => Promise.resolve('<meta property="og:image" content="https://i.scdn.co/scraped.jpg"><meta property="og:title" content="Nova Reyes — Spotify">'),
            });
        });
        const { fetchLinkPreview } = await import('../linkPreview');
        const result = await fetchLinkPreview('https://open.spotify.com/artist/spot1');
        expect(result).toEqual({ imageUrl: 'https://i.scdn.co/scraped.jpg', title: 'Nova Reyes — Spotify' });
        expect(global.fetch).toHaveBeenCalledTimes(2); // oEmbed, then scrape fallback
    });

    it('extracts og:image and og:title for a non-Spotify URL (e.g. Instagram) via the bot UA', async () => {
        global.fetch = jest.fn((url: string, init: { headers?: Record<string, string> }) => {
            expect(init?.headers?.['User-Agent']).toBe('MusicNerdBot/1.0');
            return Promise.resolve({
                ok: true,
                text: () => Promise.resolve('<meta content="https://scontent-x.cdninstagram.com/photo.jpg" property="og:image"><meta property="og:title" content="Nova Reyes (@nova) • Instagram photos and videos">'),
            });
        });
        const { fetchLinkPreview } = await import('../linkPreview');
        const result = await fetchLinkPreview('https://instagram.com/nova');
        expect(result).toEqual({
            imageUrl: 'https://scontent-x.cdninstagram.com/photo.jpg',
            title: 'Nova Reyes (@nova) • Instagram photos and videos',
        });
    });

    it('resolves to nulls (not an error) when the page has no og:image at all (e.g. X/Twitter, Apple Music)', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<html><head><title>X</title></head><body>no og tags here</body></html>'),
        }));
        const { fetchLinkPreview } = await import('../linkPreview');
        const result = await fetchLinkPreview('https://x.com/novareyes');
        expect(result).toEqual({ imageUrl: null, title: null });
    });

    it('decodes HTML entities in og:image before use — a signed CDN URL with &amp; in its query string must not come back escaped', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<meta property="og:image" content="https://scontent-x.cdninstagram.com/photo.jpg?_nc_ht=x&amp;oh=y&amp;oe=z">'),
        }));
        const { fetchLinkPreview } = await import('../linkPreview');
        const result = await fetchLinkPreview('https://instagram.com/nova');
        expect(result.imageUrl).toBe('https://scontent-x.cdninstagram.com/photo.jpg?_nc_ht=x&oh=y&oe=z');
    });

    it('rejects a non-https image URL from og:image (data URI / relative path)', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<meta property="og:image" content="data:image/png;base64,abc123">'),
        }));
        const { fetchLinkPreview } = await import('../linkPreview');
        const result = await fetchLinkPreview('https://example.com/artist');
        expect(result.imageUrl).toBeNull();
    });
});
