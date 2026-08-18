// @ts-nocheck
import { renderHook, act } from '@testing-library/react';
import { useOnboardingChat } from '../useOnboardingChat';

// Mock fetch for every test in this file — the hook's real risk surface (SSE
// buffer/frame-split parsing, error classification, userEcho) never touches
// the network, so we control the Response shape entirely.
global.fetch = jest.fn();

function encode(text: string) {
    return new TextEncoder().encode(text);
}

/** Builds a minimal fetch-Response-like object backed by a scripted reader. */
function fakeStreamResponse(chunks: string[]) {
    const reads = chunks.map(chunk => ({ done: false, value: encode(chunk) }));
    const read = jest.fn();
    reads.forEach(r => read.mockResolvedValueOnce(r));
    read.mockResolvedValue({ done: true, value: undefined });
    return {
        ok: true,
        body: { getReader: () => ({ read }) },
    };
}

describe('useOnboardingChat', () => {
    beforeEach(() => {
        (global.fetch as jest.Mock).mockReset();
    });

    it('a) happy path — single chunk with a chat frame and a complete frame', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            fakeStreamResponse(['data: {"kind":"chat","text":"Hi there"}\n\ndata: {"kind":"complete"}\n\n'])
        );

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        expect(result.current.items.some(i => i.kind === 'bot' && i.text === 'Hi there')).toBe(true);
        expect(result.current.items.some(i => i.kind === 'complete')).toBe(true);
        expect(result.current.busy).toBe(false);
    });

    it('b) frame split across reads — retained buffer reassembles the frame', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            fakeStreamResponse([
                'data: {"kind":"chat","text":"hel',
                'lo"}\n\ndata: {"kind":"complete"}\n\n',
            ])
        );

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        const bot = result.current.items.find(i => i.kind === 'bot');
        expect(bot?.text).toBe('hello');
        expect(result.current.items.some(i => i.kind === 'complete')).toBe(true);
    });

    it('c) non-SSE JSON failure — error item carries the server message, no crash', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Not authorized' }),
        });

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        expect(result.current.items.some(i => i.kind === 'error' && i.text === 'Not authorized')).toBe(true);
        expect(result.current.busy).toBe(false);
    });

    it('d) network throw — error item appears and busy returns to false', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        expect(result.current.items.some(i => i.kind === 'error')).toBe(true);
        expect(result.current.busy).toBe(false);
    });

    it('e) userEcho — interview_answer with null answer echoes "Skip that one."; with an answer echoes the answer', async () => {
        (global.fetch as jest.Mock).mockResolvedValue(fakeStreamResponse(['']));

        const { result } = renderHook(() => useOnboardingChat('artist-1'));

        await act(async () => {
            await result.current.sendTurn({ type: 'interview_answer', questionKey: 'x', answer: null });
        });
        expect(result.current.items.some(i => i.kind === 'user' && i.text === 'Skip that one.')).toBe(true);

        await act(async () => {
            await result.current.sendTurn({ type: 'interview_answer', questionKey: 'x', answer: 'Paris' });
        });
        expect(result.current.items.some(i => i.kind === 'user' && i.text === 'Paris')).toBe(true);
    });
});
