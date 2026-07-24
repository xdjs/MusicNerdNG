import { renderHook, waitFor } from '@testing-library/react';
import { useArtistBio } from '@/hooks/useArtistBio';

// Mock fetch
global.fetch = jest.fn();

describe('useArtistBio', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
  });

  it('should fetch bio on first call', async () => {
    const mockBio = 'Test artist bio';
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ bio: mockBio }),
    });

    const { result } = renderHook(() => useArtistBio('test-artist-id'));

    expect(result.current.loading).toBe(true);
    expect(result.current.bio).toBeUndefined();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.bio).toBe(mockBio);
    expect(fetch).toHaveBeenCalledWith('/api/artistBio/test-artist-id');
  });

  it('should strip markdown citations from a server-provided bio', () => {
    const dirty =
      'Her new single dropped in December. ([music.apple.com](https://music.apple.com/us/song/1758574026?utm_source=openai))';

    const { result } = renderHook(() => useArtistBio('test-artist-id', dirty));

    expect(result.current.bio).toBe('Her new single dropped in December.');
    expect(result.current.loading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should strip markdown citations from a fetched bio', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bio: 'Out now on Sound.xyz. ([sound.xyz](https://www.sound.xyz/honey?utm_source=openai))',
      }),
    });

    const { result } = renderHook(() => useArtistBio('test-artist-id'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.bio).toBe('Out now on Sound.xyz.');
  });

  it('should use cached bio on subsequent calls', async () => {
    const mockBio = 'Test artist bio';
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ bio: mockBio }),
    });

    // First call
    const { result: result1 } = renderHook(() => useArtistBio('test-artist-id'));
    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    // Second call - should use cache
    const { result: result2 } = renderHook(() => useArtistBio('test-artist-id'));
    
    expect(result2.current.bio).toBe(mockBio);
    expect(result2.current.loading).toBe(false);
    
    // Should only have called fetch once
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should handle fetch errors gracefully', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useArtistBio('test-artist-id'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.bio).toBe('Failed to load summary.');
    expect(result.current.error).toBe('Network error');
  });
});
