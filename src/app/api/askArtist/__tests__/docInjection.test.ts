// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getVaultSourcesByArtistId: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/artistDocService', () => ({ getArtistDocContext: jest.fn() }));
jest.mock('@/server/lib/gemini', () => ({ getGemini: jest.fn(), GEMINI_MODEL_FLASH: 'gemini-2.5-flash' }));

if (!('json' in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

describe('POST /api/askArtist injects the artist doc', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    it('adds the ARTIST DOC block to the system instruction when a doc exists', async () => {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getArtistDocContext } = await import('@/server/utils/artistDocService');
        const { getGemini } = await import('@/server/lib/gemini');
        const generateContent = jest.fn().mockResolvedValue({ text: 'answer' });
        getGemini.mockReturnValue({ models: { generateContent } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes' });
        getArtistDocContext.mockResolvedValue('## Story hooks\n- records in a water tower');

        const { POST } = await import('../route');
        const res = await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'What is her studio like?' }),
        }));

        expect(res.status).toBe(200);
        const sys = generateContent.mock.calls[0][0].config.systemInstruction;
        expect(sys).toContain('--- ARTIST DOC');
        expect(sys).toContain('water tower');
    });

    it('still answers when doc lookup throws', async () => {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { getArtistDocContext } = await import('@/server/utils/artistDocService');
        const { getGemini } = await import('@/server/lib/gemini');
        getGemini.mockReturnValue({ models: { generateContent: jest.fn().mockResolvedValue({ text: 'answer' }) } });
        getArtistById.mockResolvedValue({ id: 'a1', name: 'Nova Reyes' });
        getArtistDocContext.mockRejectedValue(new Error('boom'));

        const { POST } = await import('../route');
        const res = await POST(new Request('http://x/api/askArtist', {
            method: 'POST',
            body: JSON.stringify({ artistId: 'a1', question: 'hello?' }),
        }));
        expect(res.status).toBe(200);
    });
});
