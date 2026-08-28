// @ts-nocheck
/**
 * The scheduler. Its absence is what this file exists to stop coming back:
 * the route documented "called by a scheduler" while nothing scheduled it, so
 * a job only advanced while a browser tab was open on the artist's page.
 */
import { jest } from '@jest/globals';

const advanceResearch = jest.fn();
jest.mock('@/server/utils/researchRunner', () => ({ advanceResearch: (...a) => advanceResearch(...a) }));

if (!('json' in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

const get = async (headers = {}) => {
    const { GET } = await import('../route');
    return GET(new Request('http://x/api/research/advance', { headers }));
};

describe('GET /api/research/advance', () => {
    beforeEach(() => { jest.resetModules(); advanceResearch.mockReset(); delete process.env.CRON_SECRET; });

    it('keeps taking slices while there is budget', async () => {
        // One slice a minute would take half an hour to read a 300-post feed,
        // and there is a whole invocation here.
        advanceResearch
            .mockResolvedValueOnce({ ran: true, kind: 'caption_extract', progress: 'batch 6/30' })
            .mockResolvedValueOnce({ ran: true, kind: 'caption_extract', progress: 'batch 9/30' })
            .mockResolvedValue({ ran: false });

        const body = await (await get()).json();
        expect(body.ran).toBe(true);
        expect(body.slices).toHaveLength(2);
        expect(advanceResearch).toHaveBeenCalledTimes(3);
    });

    it('stops the moment the queue is empty', async () => {
        // An idle queue must cost one database round trip per tick, not a
        // minute of spinning.
        advanceResearch.mockResolvedValue({ ran: false });
        const body = await (await get()).json();
        expect(body).toEqual({ ran: false, slices: [] });
        expect(advanceResearch).toHaveBeenCalledTimes(1);
    });

    it('claims whatever is next rather than naming an artist', async () => {
        // The queue decides the order. A scheduler that picked artists would
        // need to know which ones are behind, which is the queue's job.
        advanceResearch.mockResolvedValue({ ran: false });
        await get();
        expect(advanceResearch.mock.calls[0][0].artistId).toBeUndefined();
        expect(advanceResearch.mock.calls[0][0].budgetMs).toBeGreaterThan(0);
    });

    it('requires the secret once one is configured', async () => {
        process.env.CRON_SECRET = 's3cret';
        advanceResearch.mockResolvedValue({ ran: false });

        const denied = await get();
        expect(denied.status).toBe(401);
        expect(advanceResearch).not.toHaveBeenCalled();

        const allowed = await get({ authorization: 'Bearer s3cret' });
        expect(allowed.status).toBe(200);
        expect(advanceResearch).toHaveBeenCalled();
    });

    it('stays open when no secret is set, so local and preview still pump', async () => {
        advanceResearch.mockResolvedValue({ ran: false });
        expect((await get()).status).toBe(200);
    });

    it('keeps the slices it finished when a later one throws', async () => {
        // A worker that loses its completed work to an error on the next slice
        // is worse than one that does less.
        advanceResearch
            .mockResolvedValueOnce({ ran: true, progress: 'batch 6/30' })
            .mockRejectedValueOnce(new Error('gemini exploded'));
        const body = await (await get()).json();
        expect(body.slices).toHaveLength(1);
        expect(body.ran).toBe(true);
        expect(body.error).toBe('advance failed');
    });
});
