import type { Session } from 'next-auth';

// Create mock session state
export const createMockSession = (authenticated: boolean = true): Session | null => {
    if (!authenticated) return null;
    return {
        user: { id: 'test-user-id' },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    };
};

// Mock auth utilities
export const mockAuth = {
    getSession: jest.fn(async () => createMockSession(true)),
    validateSession: jest.fn(async () => createMockSession(true))
};

// Basic tests to verify mock functionality
describe('mockAuth', () => {
    it('should create authenticated session', () => {
        const session = createMockSession(true);
        expect(session).toBeTruthy();
        expect(session?.user.id).toBe('test-user-id');
    });

    it('should create unauthenticated session', () => {
        const session = createMockSession(false);
        expect(session).toBeNull();
    });

    it('should return session from getSession', async () => {
        const session = await mockAuth.getSession();
        expect(session).toBeTruthy();
        expect(session?.user.id).toBe('test-user-id');
    });
}); 