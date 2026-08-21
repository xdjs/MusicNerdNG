// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
    approveClaim: jest.fn(), rejectClaim: jest.fn(), getAllClaims: jest.fn(),
    getClaimById: jest.fn(), revokeApprovedClaim: jest.fn(),
}));
jest.mock('@/server/utils/queries/vaultWebSearch', () => ({ searchAndPopulateVault: jest.fn().mockResolvedValue([]) }));
jest.mock('@/server/utils/queries/discord', () => ({ sendDiscordMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/server/utils/email', () => ({ sendClaimApprovedEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('@/server/utils/queries/artistQueries', () => ({ getArtistById: jest.fn() }));
jest.mock('@/app/api/mcp/audit', () => ({ logMcpAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/server/lib/supabase', () => ({ getSupabaseAdmin: jest.fn(), VAULT_BUCKET: 'vault' }));

describe('approveClaimAction sends the approval email', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    async function setup({ email }) {
        const { getServerAuthSession } = await import('@/server/auth');
        const { getUserById } = await import('@/server/utils/queries/userQueries');
        const { approveClaim } = await import('@/server/utils/queries/dashboardQueries');
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { sendClaimApprovedEmail } = await import('@/server/utils/email');

        getServerAuthSession.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@x.y' } });
        // First getUserById call = admin check; second = claimant lookup
        getUserById
            .mockResolvedValueOnce({ id: 'admin-1', isAdmin: true })
            .mockResolvedValueOnce({ id: 'user-9', email });
        approveClaim.mockResolvedValue({ id: 'claim-1', artistId: 'artist-1', userId: 'user-9', referenceCode: 'MN-TEST' });
        getArtistById.mockResolvedValue({ id: 'artist-1', name: 'Nova Reyes' });

        const { approveClaimAction } = await import('@/app/actions/adminClaimActions');
        return { approveClaimAction, sendClaimApprovedEmail };
    }

    it('emails the claimant when they have an email — AWAITED, not a floating promise (I5)', async () => {
        const { approveClaimAction, sendClaimApprovedEmail } = await setup({ email: 'artist@example.com' });
        const result = await approveClaimAction('claim-1');
        // No flush()/setTimeout(0) here on purpose: if the send were still a
        // fire-and-forget `void (async () => {...})()`, this assertion would run
        // before the microtask queue drains and could see zero calls — that's
        // exactly the failure mode I5 fixes. Asserting immediately after the
        // awaited action returns is what pins "awaited" vs "floating".
        expect(result.success).toBe(true);
        expect(sendClaimApprovedEmail).toHaveBeenCalledWith('artist@example.com', 'Nova Reyes', 'artist-1');
    });

    it('skips the send (and still succeeds) when users.email is NULL — legacy wallet user', async () => {
        const { approveClaimAction, sendClaimApprovedEmail } = await setup({ email: null });
        const result = await approveClaimAction('claim-1');
        expect(result.success).toBe(true);
        expect(sendClaimApprovedEmail).not.toHaveBeenCalled();
    });

    it('still succeeds (and never fails approval) when the email send itself rejects', async () => {
        const { approveClaimAction, sendClaimApprovedEmail } = await setup({ email: 'artist@example.com' });
        sendClaimApprovedEmail.mockRejectedValueOnce(new Error('resend down'));
        const result = await approveClaimAction('claim-1');
        expect(result.success).toBe(true);
    });

    it('passes null (not a "your artist" placeholder) to sendClaimApprovedEmail when the artist name is unknown', async () => {
        const { getArtistById } = await import('@/server/utils/queries/artistQueries');
        const { approveClaimAction, sendClaimApprovedEmail } = await setup({ email: 'artist@example.com' });
        getArtistById.mockResolvedValue(undefined); // artist lookup came back empty
        await approveClaimAction('claim-1');
        expect(sendClaimApprovedEmail).toHaveBeenCalledWith('artist@example.com', null, 'artist-1');
    });
});
