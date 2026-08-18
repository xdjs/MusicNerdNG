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

    it.each(['decisions', 'addedLinks', 'addedUrls'])(
        '400s when %s has more than 100 entries',
        async (field) => {
            const { POST } = await setup();
            const res = await POST(
                makeReq({ type: 'vault_review', [field]: Array.from({ length: 101 }, (_, i) => i) }),
                params
            );
            expect(res.status).toBe(400);
        }
    );

    describe('streaming responses', () => {
        // jest-fetch-mock's enableFetchMocks() (called in testEnv.ts) replaces
        // global.Response in every jest environment with a node-fetch polyfill
        // that stringifies a ReadableStream body to "[object ReadableStream]".
        // Swap in StreamCaptureResponse — which stores the route's real stream
        // untouched. beforeEach installs the swap BEFORE setup() dynamically
        // imports the route module (which transitively re-evaluates
        // next/server), so this covers module re-import through POST — not
        // merely "while POST runs". afterEach restores the global so the
        // auth tests above (and any other suite) keep using the polyfilled
        // Response. Caution: any error-path assertion added inside this
        // block runs against a NextResponse (e.g. Response.json(...)) built
        // on StreamCaptureResponse, a test double, not a spec-compliant
        // Response — its .json()/.text() behavior is not guaranteed to
        // match a real fetch Response.
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
            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('text/event-stream');
            expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
            expect(res.headers.get('Connection')).toBe('keep-alive');
            const text = await readAll(res);
            // Exact equality (not toContain) pins the \n\n frame terminator,
            // ordering, and absence of stray bytes — Task 9's client parser
            // splits SSE frames on \n\n, so this framing is load-bearing.
            expect(text).toBe('data: {"kind":"chat","text":"hello"}\n\ndata: {"kind":"complete"}\n\n');
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

        it('does not 400 at exactly 100 entries (boundary) — streams normally', async () => {
            const { POST } = await setup();
            const res = await POST(
                makeReq({ type: 'vault_review', decisions: Array.from({ length: 100 }, (_, i) => i), addedUrls: [] }),
                params
            );
            expect(res.status).toBe(200);
        });

        it('guards enqueue/close against a disconnected client — logs instead of throwing', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const { POST, runOnboardingTurn } = await setup();
            let resolveContinue;
            const paused = new Promise(r => { resolveContinue = r; });
            runOnboardingTurn.mockImplementation(async function* () {
                yield { kind: 'chat', text: 'first' };
                await paused;
                // Enqueuing after the reader below cancels the stream throws per
                // spec — the guard must catch it (and the subsequent close()) and
                // log instead of propagating an unhandled rejection.
                yield { kind: 'chat', text: 'after-disconnect' };
                yield { kind: 'complete' };
            });
            const res = await POST(makeReq({ type: 'open' }), params);
            const reader = res.body.getReader();
            await reader.read(); // consume "first"
            await reader.cancel('client went away');
            resolveContinue();
            // Give the producer's microtask queue a tick to attempt the guarded
            // enqueue()/close() calls on the now-cancelled stream.
            await new Promise(r => setTimeout(r, 20));
            const loggedGuard = errorSpy.mock.calls.some(
                call => typeof call[0] === 'string' && call[0].includes('after stream closed')
            );
            expect(loggedGuard).toBe(true);
            errorSpy.mockRestore();
        });
    });
});
