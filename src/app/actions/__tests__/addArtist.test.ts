jest.mock('@/server/auth', () => ({
  getServerAuthSession: jest.fn(),
}));

jest.mock('@/server/utils/dev-auth', () => ({
  getDevSession: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/server/utils/queries/artistQueries', () => ({
  addArtist: jest.fn(),
}));

import { addArtist } from '../addArtist';
import { getServerAuthSession } from '@/server/auth';
import { addArtist as dbAddArtist } from '@/server/utils/queries/artistQueries';

const mockGetSession = getServerAuthSession as jest.Mock;
const mockDbAddArtist = dbAddArtist as jest.Mock;

describe('addArtist Server Action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an error response when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(addArtist('test-id')).resolves.toEqual({
      status: 'error',
      code: 'UNAUTHENTICATED',
      message: 'Please log in to add artists',
    });
    expect(mockDbAddArtist).not.toHaveBeenCalled();
  });

  it('should return success when artist is added via spotify (default)', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockDbAddArtist.mockResolvedValue({ status: 'success', artistId: '123', artistName: 'Test Artist' });

    const result = await addArtist('test-spotify-id');

    expect(mockDbAddArtist).toHaveBeenCalledWith('test-spotify-id', 'spotify', undefined);
    expect(result).toEqual({ status: 'success', artistId: '123', artistName: 'Test Artist' });
  });

  it('should return success when artist is added via deezer', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockDbAddArtist.mockResolvedValue({ status: 'success', artistId: '456', artistName: 'Deezer Artist' });

    const result = await addArtist('12345', 'deezer');

    expect(mockDbAddArtist).toHaveBeenCalledWith('12345', 'deezer', undefined);
    expect(result).toEqual({ status: 'success', artistId: '456', artistName: 'Deezer Artist' });
  });

  it('forwards the force-create confirmation', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockDbAddArtist.mockResolvedValue({ status: 'success', artistId: '789', artistName: 'Separate Artist' });

    await addArtist('test-spotify-id', 'spotify', { forceCreate: true });

    expect(mockDbAddArtist).toHaveBeenCalledWith(
      'test-spotify-id',
      'spotify',
      { forceCreate: true },
    );
  });
});
