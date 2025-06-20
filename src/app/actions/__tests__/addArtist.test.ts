import { addArtist } from '../addArtist';
import { getServerAuthSession } from '@/server/auth';
import { getSpotifyHeaders, getSpotifyArtist } from '@/server/utils/externalApiQueries';
import { getUserById, sendDiscordMessage, addArtist as dbAddArtist } from '@/server/utils/queriesTS';

// Mock all dependencies
jest.mock('@/server/auth');
jest.mock('@/server/utils/externalApiQueries');
jest.mock('@/server/utils/queriesTS');

const mockGetServerAuthSession = getServerAuthSession as jest.MockedFunction<typeof getServerAuthSession>;
const mockGetSpotifyHeaders = getSpotifyHeaders as jest.MockedFunction<typeof getSpotifyHeaders>;
const mockGetSpotifyArtist = getSpotifyArtist as jest.MockedFunction<typeof getSpotifyArtist>;
const mockGetUserById = getUserById as jest.MockedFunction<typeof getUserById>;
const mockSendDiscordMessage = sendDiscordMessage as jest.MockedFunction<typeof sendDiscordMessage>;
const mockDbAddArtist = dbAddArtist as jest.MockedFunction<typeof dbAddArtist>;

describe('addArtist Server Action', () => {
  const mockSpotifyId = 'test-spotify-id-123';
  const mockSession = {
    user: {
      id: 'user-123',
      walletAddress: '0x1234567890123456789012345678901234567890'
    }
  };
  const mockUser = {
    id: 'user-123',
    wallet: '0x1234567890123456789012345678901234567890',
    isWhiteListed: true,
    email: 'test@example.com',
    username: 'testuser'
  };
  const mockSpotifyHeaders = {
    headers: {
      Authorization: 'Bearer spotify-token-123'
    }
  };
  const mockSpotifyArtist = {
    data: {
      id: mockSpotifyId,
      name: 'Test Artist',
      images: [{ url: 'https://example.com/image.jpg', height: 640, width: 640 }],
      followers: { total: 1000 },
      genres: ['pop', 'rock'],
      type: 'artist',
      uri: `spotify:artist:${mockSpotifyId}`,
      external_urls: { spotify: `https://open.spotify.com/artist/${mockSpotifyId}` }
    },
    error: null
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Set default environment
    process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';
  });

  afterEach(() => {
    // Reset environment
    delete process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT;
  });

  describe('Authentication', () => {
    it('should throw error when not authenticated and wallet is required', async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      await expect(addArtist(mockSpotifyId)).rejects.toThrow('Not authenticated');

      expect(mockGetServerAuthSession).toHaveBeenCalledTimes(1);
      expect(mockGetSpotifyHeaders).not.toHaveBeenCalled();
    });

    it('should proceed when wallet requirement is disabled', async () => {
      process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';
      mockGetServerAuthSession.mockResolvedValue(null);
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist);
      mockDbAddArtist.mockResolvedValue({
        status: 'success',
        artistId: 'artist-123',
        artistName: 'Test Artist'
      });

      const result = await addArtist(mockSpotifyId);

      expect(result.status).toBe('success');
      expect(mockGetServerAuthSession).toHaveBeenCalledTimes(1);
      expect(mockGetSpotifyHeaders).toHaveBeenCalledTimes(1);
      expect(mockSendDiscordMessage).not.toHaveBeenCalled(); // No user data
    });

    it('should proceed when authenticated with valid session', async () => {
      mockGetServerAuthSession.mockResolvedValue(mockSession);
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist);
      mockGetUserById.mockResolvedValue(mockUser);
      mockDbAddArtist.mockResolvedValue({
        status: 'success',
        artistId: 'artist-123',
        artistName: 'Test Artist'
      });
      mockSendDiscordMessage.mockResolvedValue();

      const result = await addArtist(mockSpotifyId);

      expect(result.status).toBe('success');
      expect(mockGetServerAuthSession).toHaveBeenCalledTimes(1);
      expect(mockGetUserById).toHaveBeenCalledWith('user-123');
    });
  });

  describe('Spotify Integration', () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(mockSession);
      mockGetUserById.mockResolvedValue(mockUser);
    });

    it('should return error when Spotify headers fail', async () => {
      mockGetSpotifyHeaders.mockResolvedValue({ headers: { Authorization: null } });

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'Failed to authenticate with Spotify'
      });
      expect(mockGetSpotifyArtist).not.toHaveBeenCalled();
    });

    it('should return error when Spotify artist fetch fails', async () => {
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue({
        data: null,
        error: 'Artist not found'
      });

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'Artist not found'
      });
      expect(mockDbAddArtist).not.toHaveBeenCalled();
    });

    it('should return error when Spotify artist data is invalid', async () => {
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue({
        data: { id: mockSpotifyId, name: null }, // Invalid - missing name
        error: null
      });

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'Invalid artist data received from Spotify'
      });
      expect(mockDbAddArtist).not.toHaveBeenCalled();
    });

    it('should successfully process valid Spotify artist', async () => {
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist);
      mockDbAddArtist.mockResolvedValue({
        status: 'success',
        artistId: 'artist-123',
        artistName: 'Test Artist'
      });
      mockSendDiscordMessage.mockResolvedValue();

      const result = await addArtist(mockSpotifyId);

      expect(result.status).toBe('success');
      expect(mockGetSpotifyArtist).toHaveBeenCalledWith(mockSpotifyId, mockSpotifyHeaders);
      expect(mockDbAddArtist).toHaveBeenCalledWith(mockSpotifyId);
    });
  });

  describe('Database Integration', () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(mockSession);
      mockGetUserById.mockResolvedValue(mockUser);
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist);
    });

    it('should handle successful artist addition', async () => {
      mockDbAddArtist.mockResolvedValue({
        status: 'success',
        artistId: 'artist-123',
        artistName: 'Test Artist'
      });
      mockSendDiscordMessage.mockResolvedValue();

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'success',
        artistId: 'artist-123',
        artistName: 'Test Artist'
      });
      expect(mockSendDiscordMessage).toHaveBeenCalledWith(
        `${mockUser.wallet} added new artist named: Test Artist (Submitted SpotifyId: ${mockSpotifyId})`
      );
    });

    it('should handle artist already exists', async () => {
      mockDbAddArtist.mockResolvedValue({
        status: 'exists',
        message: 'Artist already exists'
      });

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'exists',
        message: 'Artist already exists'
      });
      expect(mockSendDiscordMessage).not.toHaveBeenCalled(); // No message for existing artists
    });

    it('should handle database errors', async () => {
      mockDbAddArtist.mockResolvedValue({
        status: 'error',
        message: 'Database connection failed'
      });

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'Database connection failed'
      });
      expect(mockSendDiscordMessage).not.toHaveBeenCalled();
    });
  });

  describe('User Management', () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(mockSession);
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist);
      mockDbAddArtist.mockResolvedValue({
        status: 'success',
        artistId: 'artist-123',
        artistName: 'Test Artist'
      });
    });

    it('should handle user not found', async () => {
      mockGetUserById.mockResolvedValue(null);
      mockSendDiscordMessage.mockResolvedValue();

      const result = await addArtist(mockSpotifyId);

      expect(result.status).toBe('success');
      expect(mockGetUserById).toHaveBeenCalledWith('user-123');
      expect(mockSendDiscordMessage).not.toHaveBeenCalled(); // No message when no user
    });

    it('should send Discord notification for valid user', async () => {
      mockGetUserById.mockResolvedValue(mockUser);
      mockSendDiscordMessage.mockResolvedValue();

      const result = await addArtist(mockSpotifyId);

      expect(result.status).toBe('success');
      expect(mockSendDiscordMessage).toHaveBeenCalledWith(
        `${mockUser.wallet} added new artist named: Test Artist (Submitted SpotifyId: ${mockSpotifyId})`
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(mockSession);
      mockGetUserById.mockResolvedValue(mockUser);
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist);
    });

    it('should handle authentication errors', async () => {
      mockDbAddArtist.mockRejectedValue(new Error('auth failed'));

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'Please log in to add artists'
      });
    });

    it('should handle duplicate artist errors', async () => {
      mockDbAddArtist.mockRejectedValue(new Error('duplicate key error'));

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'This artist is already in our database'
      });
    });

    it('should handle generic errors', async () => {
      mockDbAddArtist.mockRejectedValue(new Error('Network timeout'));

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'Something went wrong on our end, please try again'
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockDbAddArtist.mockRejectedValue('String error');

      const result = await addArtist(mockSpotifyId);

      expect(result).toEqual({
        status: 'error',
        message: 'Something went wrong on our end, please try again'
      });
    });
  });

  describe('Session Edge Cases', () => {
    it('should handle session without user ID', async () => {
      mockGetServerAuthSession.mockResolvedValue({ user: { id: undefined } });
      mockGetSpotifyHeaders.mockResolvedValue(mockSpotifyHeaders);
      mockGetSpotifyArtist.mockResolvedValue(mockSpotifyArtist);
      mockDbAddArtist.mockResolvedValue({
        status: 'success',
        artistId: 'artist-123',
        artistName: 'Test Artist'
      });

      const result = await addArtist(mockSpotifyId);

      expect(result.status).toBe('success');
      expect(mockGetUserById).not.toHaveBeenCalled();
      expect(mockSendDiscordMessage).not.toHaveBeenCalled();
    });
  });
}); 