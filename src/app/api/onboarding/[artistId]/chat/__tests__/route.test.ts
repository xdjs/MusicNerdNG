// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn().mockResolvedValue(null) }));
jest.mock('@/server/utils/artistEditAuth', () => ({ canEditArtist: jest.fn() }));
jest.mock('@/server/utils/onboarding/turnHandlers', () => ({
    runOnboardingTurn: jest.fn(),
}));

if (!('json' in Response)) {
    Response.json = (data, init) =>
        new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            status: init?.status || 200,
        });
}

// Test double for Response that preserves the route's real ReadableStream body
class StreamCaptureResponse {
    constructor(body, init) {
        this.body = body;                     // the route's REAL ReadableStream, untouched
        this.status = init?.status ?? 200;
        this._headers = init?.headers ?? {};
        this.headers = { get: (k) => this._headers[k] ?? this._headers[k?.toLowerCase?.()] ?? null };
    }
    static json(data, init) { return new StreamCaptureResponse(JSON.stringify(data), init); }
}

async function readAll(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value);
    }
    return out;
}

const params = { params: Promise.resolve({ artistId: 'a1' }) };
const makeReq = (body) => new Request('http://x/api/onboarding/a1/chat', { method: 'POST', body: JSON.stringify(body) });

describe('POST /api/onboarding/[artistId]/chat', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ session = { user: { id: 'u1' } }, canEdit = true } = {}) {
        const { getServerAuthSession } = await import('@/server/auth');
        const { canEditArtist } = await import('@/server/utils/artistEditAuth');
        const { runOnboardingTurn } = await import('@/server/utils/onboarding/turnHandlers');
        getServerAuthSession.mockResolvedValue(session);
        canEditArtist.mockResolvedValue(canEdit);
        runOnboardingTurn.mockImplementation(async function* () {
            yield { kind: 'chat', text: 'hello' };
            yield { kind: 'complete' };
        });
        const { POST } = await import('../route');
        return { POST, canEditArtist, runOnboardingTurn };
    }

    it('401s with no session', async () => {
        const { POST } = await setup({ session: null });
        const res = await POST(makeReq({ type: 'open' }), params);
        expect(res.status).toBe(401);
    });

    it('403s when the user cannot edit this artist', async () => {
        const { POST } = await setup({ canEdit: false });
        const res = await POST(makeReq({ type: 'open' }), params);
        expect(res.status).toBe(403);
    });

    it('400s on a body without a type', async () => {
        const { POST } = await setup();
        const res = await POST(makeReq({ nope: true }), params);
        expect(res.status).toBe(400);
    });

    describe('streaming responses', () => {
        // jest-fetch-mock's enableFetchMocks() (called in testEnv.ts) replaces
        // global.Response in every jest environment with a node-fetch polyfill
        // that stringifies a ReadableStream body to "[object ReadableStream]".
        // Swap in StreamCaptureResponse — which stores the route's real stream
        // untouched — only while POST runs, then restore the global so other
        // tests (and the auth tests above) keep using the polyfilled Response.
        let OriginalResponse;

        beforeEach(() => {
            OriginalResponse = global.Response;
            global.Response = StreamCaptureResponse;
        });

        afterEach(() => {
            global.Response = OriginalResponse;
        });

        it('streams turn events as SSE data lines', async () => {
            const { POST } = await setup();
            const res = await POST(makeReq({ type: 'open' }), params);
            expect(res.headers.get('Content-Type')).toBe('text/event-stream');
            const text = await readAll(res);
            expect(text).toContain('data: {"kind":"chat","text":"hello"}');
            expect(text).toContain('data: {"kind":"complete"}');
        });

        it('converts a thrown handler error into an error event, not a crash', async () => {
            const { POST, runOnboardingTurn } = await setup();
            runOnboardingTurn.mockImplementation(async function* () {
                yield { kind: 'chat', text: 'partial' };
                throw new Error('boom');
            });
            const res = await POST(makeReq({ type: 'open' }), params);
            const text = await readAll(res);
            expect(text).toContain('"kind":"error"');
        });
    });
});
