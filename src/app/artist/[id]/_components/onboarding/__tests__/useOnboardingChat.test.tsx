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

    it('f) stream ends with no terminal frame (only progress) — pushes an error item so the hook never dead-ends silently', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            fakeStreamResponse(['data: {"kind":"progress","label":"Thinking","done":false}\n\n'])
        );

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        expect(result.current.items.some(i => i.kind === 'error')).toBe(true);
        expect(result.current.busy).toBe(false);
    });

    it('g) stream ending WITH a terminal frame (complete) does not push a spurious extra error', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            fakeStreamResponse(['data: {"kind":"chat","text":"hi"}\n\ndata: {"kind":"complete"}\n\n'])
        );

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        expect(result.current.items.some(i => i.kind === 'error')).toBe(false);
    });

    it('h) grouped progress events (group set) collapse onto ONE chat item that updates in place as the count climbs, and settles once "done" arrives', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            fakeStreamResponse([
                'data: {"kind":"progress","label":"Searching 1 platform…","done":false,"group":"platform-search"}\n\n' +
                'data: {"kind":"progress","label":"Searching 2 platforms…","done":false,"group":"platform-search"}\n\n' +
                'data: {"kind":"progress","label":"Searched 2 platforms","done":true,"group":"platform-search"}\n\n' +
                'data: {"kind":"complete"}\n\n',
            ])
        );

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        const groupItems = result.current.items.filter(i => i.kind === 'progress' && i.group === 'platform-search');
        // ONE element for the whole batch, not one per event.
        expect(groupItems).toHaveLength(1);
        expect(groupItems[0].text).toBe('Searched 2 platforms');
        expect(groupItems[0].done).toBe(true);
    });

    it('i) repeated + out-of-order-feeling progress updates for the same group never spawn a second element or flicker done back to false', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            fakeStreamResponse([
                'data: {"kind":"progress","label":"Searching 1 platform…","done":false,"group":"platform-search"}\n\n' +
                // A repeat "searching" for a platform already counted re-sends
                // the SAME label/done (server never regresses the count) —
                // must reconcile onto the same item, not double up.
                'data: {"kind":"progress","label":"Searching 1 platform…","done":false,"group":"platform-search"}\n\n' +
                'data: {"kind":"progress","label":"Searching 2 platforms…","done":false,"group":"platform-search"}\n\n' +
                'data: {"kind":"progress","label":"Searched 2 platforms","done":true,"group":"platform-search"}\n\n' +
                'data: {"kind":"complete"}\n\n',
            ])
        );

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        const groupItems = result.current.items.filter(i => i.kind === 'progress' && i.group === 'platform-search');
        expect(groupItems).toHaveLength(1);
        expect(groupItems[0].done).toBe(true);
        expect(groupItems[0].text).toBe('Searched 2 platforms');
    });

    it('j) a lone, non-grouped progress chip (no `group` field) still renders/updates by label match exactly as before', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(
            fakeStreamResponse([
                'data: {"kind":"progress","label":"Gathering your profiles","done":false}\n\n' +
                'data: {"kind":"progress","label":"Gathering your profiles","done":true}\n\n' +
                'data: {"kind":"complete"}\n\n',
            ])
        );

        const { result } = renderHook(() => useOnboardingChat('artist-1'));
        await act(async () => {
            await result.current.sendTurn({ type: 'open' });
        });

        const items = result.current.items.filter(i => i.kind === 'progress');
        expect(items).toHaveLength(1);
        expect(items[0].text).toBe('Gathering your profiles');
        expect(items[0].done).toBe(true);
        expect(items[0].group).toBeUndefined();
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
