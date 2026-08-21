// @ts-nocheck
import { jest } from '@jest/globals';

async function setupWithEnv(env: { TAVILY_API_KEY?: string; WEB_SEARCH_PROVIDER?: string }) {
    jest.resetModules();
    jest.doMock('@/env', () => ({
        TAVILY_API_KEY: env.TAVILY_API_KEY ?? '',
        WEB_SEARCH_PROVIDER: env.WEB_SEARCH_PROVIDER ?? 'tavily',
    }));
    const { webSearch } = await import('../webSearch');
    return webSearch;
}

describe('webSearch', () => {
    const realFetch = global.fetch;

    afterEach(() => {
        global.fetch = realFetch;
        jest.dontMock('@/env');
        jest.resetModules();
    });

    it('returns [] immediately and never calls fetch when TAVILY_API_KEY is missing', async () => {
        global.fetch = jest.fn();
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: '' });

        const result = await webSearch('Pete Rango music artist', { includeDomains: ['instagram.com'] });

        expect(result).toEqual([]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never throws when fetch rejects outright (network down)', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-test-key' });

        await expect(webSearch('Pete Rango music artist')).resolves.toEqual([]);
    });

    it('never throws on a non-OK HTTP response', async () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401 }));
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-test-key' });

        await expect(webSearch('Pete Rango music artist')).resolves.toEqual([]);
    });

    it('never throws on a garbage/unparseable body', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.reject(new Error('not json')),
        }));
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-test-key' });

        await expect(webSearch('Pete Rango music artist')).resolves.toEqual([]);
    });

    it('never throws and returns [] when the response body has no results array', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ answer: 'something', results: 'not-an-array' }),
        }));
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-test-key' });

        await expect(webSearch('Pete Rango music artist')).resolves.toEqual([]);
    });

    it('sends a Bearer-authenticated POST to api.tavily.com/search with snake_case fields', async () => {
        let capturedUrl: string | undefined;
        let capturedInit: RequestInit | undefined;
        global.fetch = jest.fn((url: string, init: RequestInit) => {
            capturedUrl = url;
            capturedInit = init;
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
        });
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-secret-123' });

        await webSearch('Pete Rango music artist', { includeDomains: ['instagram.com'], maxResults: 3 });

        expect(capturedUrl).toBe('https://api.tavily.com/search');
        expect(capturedInit?.method).toBe('POST');
        expect(capturedInit?.headers).toMatchObject({
            'Content-Type': 'application/json',
            Authorization: 'Bearer tvly-secret-123',
        });
        const body = JSON.parse(capturedInit?.body as string);
        expect(body).toEqual({
            query: 'Pete Rango music artist',
            include_domains: ['instagram.com'],
            max_results: 3,
        });
    });

    it('defaults maxResults/includeDomains when opts is omitted', async () => {
        let capturedBody: string | undefined;
        global.fetch = jest.fn((_url: string, init: RequestInit) => {
            capturedBody = init.body as string;
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
        });
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-secret-123' });

        await webSearch('Pete Rango music artist');

        const body = JSON.parse(capturedBody as string);
        expect(body.include_domains).toEqual([]);
        expect(body.max_results).toBe(5);
    });

    it('maps Tavily result rows (title/url/content) to WebSearchResult (title/url/snippet)', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                results: [
                    { title: 'Pete Rango (@p3t3rango) • Instagram', url: 'https://instagram.com/p3t3rango', content: 'Music producer from Richmond, VA.', score: 0.9 },
                ],
            }),
        }));
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-secret-123' });

        const result = await webSearch('Pete Rango music artist', { includeDomains: ['instagram.com'] });

        expect(result).toEqual([
            { title: 'Pete Rango (@p3t3rango) • Instagram', url: 'https://instagram.com/p3t3rango', snippet: 'Music producer from Richmond, VA.' },
        ]);
    });

    it('drops a result row missing a usable url, and degrades missing title/content to empty strings', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                results: [
                    { title: 'No URL here', content: 'still no url' },
                    { url: 'https://instagram.com/p3t3rango' },
                ],
            }),
        }));
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-secret-123' });

        const result = await webSearch('Pete Rango music artist');

        expect(result).toEqual([{ url: 'https://instagram.com/p3t3rango', title: '', snippet: '' }]);
    });

    it('logs and returns [] for an unknown WEB_SEARCH_PROVIDER instead of guessing a backend', async () => {
        global.fetch = jest.fn();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const webSearch = await setupWithEnv({ TAVILY_API_KEY: 'tvly-secret-123', WEB_SEARCH_PROVIDER: 'perplexity' });

        const result = await webSearch('Pete Rango music artist');

        expect(result).toEqual([]);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});
