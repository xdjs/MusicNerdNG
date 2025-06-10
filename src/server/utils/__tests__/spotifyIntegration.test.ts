import { describe, it, expect, beforeEach } from '@jest/globals';
import { getSpotifyHeaders, getSpotifyArtist } from '@/server/utils/externalApiQueries';
import axios from 'axios';
import queryString from 'querystring';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock queryString
jest.mock('querystring', () => ({
    stringify: jest.fn().mockImplementation((obj) => {
        return Object.entries(obj)
            .map(([key, value]) => `${key}=${value}`)
            .join('&');
    })
}));

// Mock @/env
jest.mock('@/env', () => ({
    SPOTIFY_WEB_CLIENT_ID: 'test-client-id',
    SPOTIFY_WEB_CLIENT_SECRET: 'test-client-secret',
    DISCORD_WEBHOOK_URL: 'mock-webhook-url'
}));

// Mock next/cache
jest.mock('next/cache', () => ({
    unstable_cache: (fn: Function) => fn,
}));

describe('Spotify API Integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset environment variables before each test
        jest.resetModules();
        jest.mock('@/env', () => ({
            SPOTIFY_WEB_CLIENT_ID: 'test-client-id',
            SPOTIFY_WEB_CLIENT_SECRET: 'test-client-secret'
        }));
    });

    describe('Authentication', () => {
        it('should get valid Spotify headers with correct credentials', async () => {
            const mockTokenResponse = {
                data: {
                    access_token: 'mock-access-token',
                    expires_in: 3600
                }
            };

            (mockedAxios.post as jest.Mock).mockResolvedValueOnce(mockTokenResponse);

            const result = await getSpotifyHeaders();

            expect(result.headers).toBeDefined();
            expect(result.headers.Authorization).toBe('Bearer mock-access-token');
            expect(result.headers['x-token-expiry']).toBeDefined();
            
            // Verify correct auth request was made
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://accounts.spotify.com/api/token',
                'grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
        });

        it('should handle missing credentials', async () => {
            // Mock missing credentials in @/env
            jest.mock('@/env', () => ({
                SPOTIFY_WEB_CLIENT_ID: '',
                SPOTIFY_WEB_CLIENT_SECRET: ''
            }));

            // Re-import the module to get the new mocked values
            const { getSpotifyHeaders } = await import('@/server/utils/externalApiQueries');

            await expect(getSpotifyHeaders()).rejects.toThrow('Spotify credentials not configured');

            // Verify that no API call was made
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it('should handle Spotify auth API errors', async () => {
            (mockedAxios.post as jest.Mock).mockRejectedValueOnce(new Error('Failed to get Spotify access token'));

            await expect(getSpotifyHeaders()).rejects.toThrow('Failed to get Spotify access token');
        });
    });

    describe('Artist Data Fetching', () => {
        const mockExpiry = new Date(Date.now() + 3600000).getTime().toString();
        const mockHeaders = {
            headers: {
                Authorization: 'Bearer mock-token',
                'x-token-expiry': mockExpiry
            }
        };

        beforeEach(() => {
            // Mock getSpotifyHeaders to return valid headers
            (mockedAxios.post as jest.Mock).mockResolvedValue({
                data: {
                    access_token: 'mock-token',
                    expires_in: 3600
                }
            });
        });

        it('should fetch artist data successfully', async () => {
            const mockArtistData = {
                data: {
                    id: 'test-spotify-id',
                    name: 'Test Artist',
                    images: [
                        {
                            url: 'https://test.com/image.jpg',
                            height: 640,
                            width: 640
                        }
                    ],
                    followers: { total: 1000 },
                    genres: ['electronic', 'techno'],
                    type: 'artist',
                    uri: 'spotify:artist:test-spotify-id',
                    external_urls: {
                        spotify: 'https://open.spotify.com/artist/test-spotify-id'
                    }
                }
            };

            (mockedAxios.get as jest.Mock).mockResolvedValueOnce(mockArtistData);

            const result = await getSpotifyArtist('test-spotify-id', mockHeaders);

            expect(result.error).toBeNull();
            expect(result.data).toBeDefined();
            expect(result.data?.name).toBe('Test Artist');
            expect(result.data?.id).toBe('test-spotify-id');
            expect(result.data?.images).toHaveLength(1);
            expect(result.data?.genres).toHaveLength(2);

            // Verify correct API call was made
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://api.spotify.com/v1/artists/test-spotify-id',
                { headers: mockHeaders.headers }
            );
        });

        it('should handle invalid Spotify IDs', async () => {
            (mockedAxios.get as jest.Mock).mockRejectedValueOnce({
                response: {
                    status: 404,
                    data: { error: { message: 'Artist not found' } }
                }
            });

            const result = await getSpotifyArtist('invalid-id', mockHeaders);

            expect(result.data).toBeNull();
            expect(result.error).toBe('Invalid Spotify ID');
        });

        it('should handle expired tokens', async () => {
            (mockedAxios.get as jest.Mock).mockRejectedValueOnce({
                response: {
                    status: 401,
                    data: { error: { message: 'The access token expired' } }
                }
            });

            const result = await getSpotifyArtist('test-spotify-id', mockHeaders);

            expect(result.data).toBeNull();
            expect(result.error).toBe('Spotify authentication failed');
        });

        it('should handle rate limiting', async () => {
            (mockedAxios.get as jest.Mock).mockRejectedValueOnce({
                response: {
                    status: 429,
                    data: { error: { message: 'Too Many Requests' } }
                }
            });

            const result = await getSpotifyArtist('test-spotify-id', mockHeaders);

            expect(result.data).toBeNull();
            expect(result.error).toBe('Rate limit exceeded, please try again later');
        });

        it('should handle network errors', async () => {
            (mockedAxios.get as jest.Mock).mockRejectedValueOnce({
                message: 'Network Error',
                response: undefined
            });

            const result = await getSpotifyArtist('test-spotify-id', mockHeaders);

            expect(result.data).toBeNull();
            expect(result.error).toBe('Network error while fetching artist data');
        });
    });

    describe('Integration Scenarios', () => {
        it('should handle complete auth and fetch flow', async () => {
            // Mock successful auth
            const mockTokenResponse = {
                data: {
                    access_token: 'mock-access-token',
                    expires_in: 3600
                }
            };

            // Mock successful artist fetch
            const mockArtistData = {
                data: {
                    id: 'test-spotify-id',
                    name: 'Test Artist',
                    images: [],
                    followers: { total: 1000 },
                    genres: [],
                    type: 'artist',
                    uri: 'spotify:artist:test-spotify-id',
                    external_urls: {
                        spotify: 'https://open.spotify.com/artist/test-spotify-id'
                    }
                }
            };

            (mockedAxios.post as jest.Mock).mockResolvedValueOnce(mockTokenResponse);
            (mockedAxios.get as jest.Mock).mockResolvedValueOnce(mockArtistData);

            // Get headers first
            const headers = await getSpotifyHeaders();
            expect(headers.headers.Authorization).toBe('Bearer mock-access-token');

            // Then fetch artist data
            const result = await getSpotifyArtist('test-spotify-id', headers);
            expect(result.error).toBeNull();
            expect(result.data?.name).toBe('Test Artist');
        });

        it('should handle auth failure in complete flow', async () => {
            // Mock auth failure
            (mockedAxios.post as jest.Mock).mockRejectedValueOnce(new Error('Failed to get Spotify access token'));

            // Attempt the complete flow
            await expect(async () => {
                const headers = await getSpotifyHeaders();
                await getSpotifyArtist('test-spotify-id', headers);
            }).rejects.toThrow('Failed to get Spotify access token');

            // Verify artist fetch was never attempted
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });
    });
}); 