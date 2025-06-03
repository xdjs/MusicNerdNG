// Mock environment variables
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_ID = 'test-client-id';
process.env.NEXT_PUBLIC_SPOTIFY_WEB_CLIENT_SECRET = 'test-client-secret';
process.env.SPOTIFY_WEB_CLIENT_SECRET = 'test-client-secret';
process.env.NEXTAUTH_SECRET = 'test-auth-secret';
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test_db'; 