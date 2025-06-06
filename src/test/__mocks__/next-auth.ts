import { Session } from 'next-auth';

const mockSession: Session = {
    user: {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        image: 'https://example.com/avatar.jpg',
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

export const useSession = jest.fn(() => ({
    data: mockSession,
    status: 'authenticated',
    update: jest.fn(),
}));

export const getSession = jest.fn(() => Promise.resolve(mockSession));

export const signIn = jest.fn(() => Promise.resolve({ ok: true, error: null }));

export const signOut = jest.fn(() => Promise.resolve({ ok: true }));

export const getServerSession = jest.fn(() => Promise.resolve(mockSession)); 