// @ts-nocheck
import { jest } from '@jest/globals';

describe('sendEmail', () => {
    beforeEach(() => { jest.resetModules(); global.fetch = jest.fn(); });

    it('skips (returns false) without throwing when RESEND_API_KEY is empty', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: '', NEXTAUTH_URL: '' }));
        const { sendEmail } = await import('@/server/utils/email');
        await expect(sendEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('POSTs to Resend with bearer auth and returns true on 200', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: '' }));
        global.fetch.mockResolvedValue({ ok: true });
        const { sendEmail } = await import('@/server/utils/email');
        await expect(sendEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBe(true);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.resend.com/emails');
        expect(init.headers.Authorization).toBe('Bearer rk_test');
        expect(JSON.parse(init.body).to).toEqual(['a@b.c']);
    });

    it('returns false (never throws) on a failed response', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: '' }));
        global.fetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'bad' });
        const { sendEmail } = await import('@/server/utils/email');
        await expect(sendEmail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' })).resolves.toBe(false);
    });
});

describe('sendClaimApprovedEmail', () => {
    beforeEach(() => { jest.resetModules(); global.fetch = jest.fn().mockResolvedValue({ ok: true }); });

    it('links the CTA to the artist page and uses Music Nerd (two words) branding', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: 'https://staging.musicnerd.xyz' }));
        const { sendClaimApprovedEmail } = await import('@/server/utils/email');
        await sendClaimApprovedEmail('artist@example.com', 'Nova Reyes', 'artist-uuid-1');
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.html).toContain('https://staging.musicnerd.xyz/artist/artist-uuid-1');
        expect(body.html).toContain('Music Nerd');
        expect(body.html).not.toMatch(/MusicNerd[^ ]/);
    });

    it('escapes HTML markup in artist name to prevent injection', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: 'https://staging.musicnerd.xyz' }));
        const { sendClaimApprovedEmail } = await import('@/server/utils/email');
        await sendClaimApprovedEmail('artist@example.com', '<script>alert(1)</script>Nova', 'artist-uuid-1');
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.html).not.toContain('<script>');
        expect(body.html).toContain('&lt;script&gt;');
    });

    it('degrades to generic-but-grammatical copy when artistName is null (no "Your your artist" doubling)', async () => {
        jest.mock('@/env', () => ({ RESEND_API_KEY: 'rk_test', NEXTAUTH_URL: 'https://staging.musicnerd.xyz' }));
        const { sendClaimApprovedEmail } = await import('@/server/utils/email');
        await sendClaimApprovedEmail('artist@example.com', null, 'artist-uuid-1');
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.subject).toBe('Your Music Nerd profile is approved 🎉');
        expect(body.subject).not.toMatch(/your your/i);
        expect(body.html).not.toMatch(/your your/i);
        expect(body.html).toContain('You now manage your artist profile on Music Nerd.');
    });
});
