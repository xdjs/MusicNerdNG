// Import types first
import { Artist, UrlMap } from '@/server/db/DbTypes';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { 
    getArtistLinks, 
    getAllLinks, 
    getArtistById, 
    getArtistByProperty,
    getArtistbyWallet,
    getArtistByNameApiResp,
    searchForArtistByName,
    getUserById,
    getUserByWallet,
    getArtistByWalletOrEns,
    addArtist,
    addArtistData,
    approveUgcAdmin,
    approveUGC,
    getPendingUGC,
    createUser,
    getUgcStats,
    getUgcStatsInRange,
    getWhitelistedUsers,
    addUsersToWhitelist,
    removeFromWhitelist,
    updateWhitelistedUser,
    searchForUsersByWallet,
    sendDiscordMessage,
    getAllSpotifyIds
} from '../queriesTS';
import { hasSpotifyCredentials } from '../setup/testEnv';

// Skip all tests if Spotify credentials are missing
const testWithSpotify = hasSpotifyCredentials ? it : it.skip;

// Mock all external dependencies
jest.mock('@/server/auth', () => ({
    getServerAuthSession: jest.fn()
}));

jest.mock('../externalApiQueries', () => ({
    getSpotifyHeaders: jest.fn(),
    getSpotifyArtist: jest.fn(),
    getSpotifyImage: jest.fn()
}));

jest.mock('../services', () => ({
    extractArtistId: jest.fn(),
    isObjKey: jest.fn()
}));

jest.mock('next/headers', () => ({
    headers: jest.fn()
}));

jest.mock('@/env', () => ({
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/test'
}));

jest.mock('axios', () => ({
    post: jest.fn()
}));

// Comprehensive DB mock
jest.mock('@/server/db/drizzle', () => {
    const makeTable = () => ({
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        insert: jest.fn(),
    });
    return {
        db: {
            query: {
                urlmap: makeTable(),
                artists: makeTable(),
                users: makeTable(),
                ugcresearch: makeTable(),
            },
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            insert: jest.fn(),
            update: jest.fn(),
            execute: jest.fn(),
        },
    };
});

// Import mocked dependencies
import { db } from '@/server/db/drizzle';
import { getServerAuthSession } from '@/server/auth';
import { getSpotifyHeaders, getSpotifyArtist } from '../externalApiQueries';
import { extractArtistId } from '../services';
import { headers } from 'next/headers';
import axios from 'axios';

// Common test data
const baseArtist: Artist = {
    id: '',
    name: '',
    legacyId: null,
    bandcamp: null,
    facebook: null,
    x: null,
    soundcloud: null,
    notes: null,
    patreon: null,
    instagram: null,
    youtube: null,
    youtubechannel: null,
    lcname: null,
    soundcloudId: null,
    spotify: null,
    twitch: null,
    imdb: null,
    musicbrainz: null,
    wikidata: null,
    mixcloud: null,
    facebookId: null,
    discogs: null,
    tiktok: null,
    tiktokId: null,
    jaxsta: null,
    famousbirthdays: null,
    songexploder: null,
    colorsxstudios: null,
    bandsintown: null,
    linktree: null,
    onlyfans: null,
    wikipedia: null,
    audius: null,
    zora: null,
    catalog: null,
    opensea: null,
    foundation: null,
    lastfm: null,
    linkedin: null,
    soundxyz: null,
    mirror: null,
    glassnode: null,
    collectsNfTs: null,
    spotifyusername: null,
    bandcampfan: null,
    tellie: null,
    wallets: [],
    ens: null,
    lens: null,
    addedBy: '00000000-0000-0000-0000-000000000000',
    cameo: null,
    farcaster: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    supercollector: null
};

const mockUrlMaps: UrlMap[] = [
    {
        id: '1',
        siteName: 'spotify',
        siteUrl: 'https://spotify.com',
        example: 'example',
        appStringFormat: 'https://open.spotify.com/artist/%@',
        order: 1,
        isIframeEnabled: false,
        isEmbedEnabled: false,
        cardDescription: 'Listen on Spotify',
        cardPlatformName: 'Spotify',
        isWeb3Site: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        siteImage: '',
        regex: '',
        regexMatcher: '',
        isMonetized: false,
        regexOptions: [],
        platformTypeList: ['listen'],
        colorHex: '#000000'
    },
    {
        id: '2',
        siteName: 'youtubechannel',
        siteUrl: 'https://youtube.com',
        example: 'example',
        appStringFormat: 'https://www.youtube.com/%@',
        order: 2,
        isIframeEnabled: false,
        isEmbedEnabled: false,
        cardDescription: 'Watch on YouTube',
        cardPlatformName: 'YouTube',
        isWeb3Site: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        siteImage: '',
        regex: '',
        regexMatcher: '',
        isMonetized: false,
        regexOptions: [],
        platformTypeList: ['social'],
        colorHex: '#FF0000'
    }
];

describe('Artist Links Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (db.query.urlmap.findMany as jest.Mock).mockResolvedValue(mockUrlMaps);
        const { isObjKey } = require('../services');
        (isObjKey as jest.Mock).mockImplementation((key: string, obj: any) => key in obj);
    });

    describe('getArtistLinks', () => {
        testWithSpotify('should generate correct artist links', async () => {
            const artist: Artist = {
                ...baseArtist,
                id: '123',
                name: 'Test Artist',
                spotify: 'spotify123',
                youtubechannel: '@testartist'
            };

            const result = await getArtistLinks(artist);

            expect(result).toHaveLength(2);
            expect(result[0].artistUrl).toBe('https://open.spotify.com/artist/spotify123');
            expect(result[1].artistUrl).toBe('https://www.youtube.com/@testartist');
        });

        it('should handle empty values', async () => {
            const artist: Artist = { ...baseArtist, id: '123', name: 'Test Artist' };
            const result = await getArtistLinks(artist);
            expect(result).toHaveLength(0);
        });

        it('should handle database errors', async () => {
            (db.query.urlmap.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const artist: Artist = { ...baseArtist, id: '123', name: 'Test Artist' };
            
            await expect(getArtistLinks(artist)).rejects.toThrow('Error fetching artist links');
        });
    });

    describe('getAllLinks', () => {
        it('should return all URL mappings', async () => {
            const result = await getAllLinks();
            expect(result).toEqual(mockUrlMaps);
        });
    });
});

describe('Artist Data Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getArtistById', () => {
        it('should return artist when found', async () => {
            const mockArtist = { id: '123', name: 'Test Artist' };
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(mockArtist);

            const result = await getArtistById('123');
            expect(result).toEqual(mockArtist);
        });

        it('should handle not found and errors', async () => {
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(undefined);
            const result = await getArtistById('nonexistent');
            expect(result).toBeUndefined();

            (db.query.artists.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'));
            await expect(getArtistById('123')).rejects.toThrow('Error fetching artist by Id');
        });
    });

    describe('getArtistByProperty', () => {
        it('should return success response when found', async () => {
            const mockArtist = { id: '123', name: 'Test Artist' };
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(mockArtist);

            const result = await getArtistByProperty({} as any, 'test-value');
            expect(result.isError).toBe(false);
            expect(result.data).toEqual(mockArtist);
        });

        it('should return 404 when not found or error occurs', async () => {
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(null);
            const result = await getArtistByProperty({} as any, 'nonexistent');
            expect(result.isError).toBe(true);
            expect(result.status).toBe(404);
        });
    });

    describe('getArtistbyWallet', () => {
        it('should find artist by wallet', async () => {
            const mockArtist = { id: '123', wallets: ['0x123'] };
            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                from: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue([mockArtist])
            };
            (db.select as jest.Mock).mockReturnValue(mockQueryBuilder);

            const result = await getArtistbyWallet('0x123');
            expect(result.isError).toBe(false);
            expect(result.data).toEqual(mockArtist);
        });
    });

    describe('searchForArtistByName', () => {
        it('should return matching artists', async () => {
            const mockArtists = [{ id: '1', name: 'Test Artist' }];
            (db.execute as jest.Mock).mockResolvedValue(mockArtists);
            jest.spyOn(console, 'log').mockImplementation();

            const result = await searchForArtistByName('Test');
            expect(result).toEqual(mockArtists);
        });

        it('should handle errors', async () => {
            (db.execute as jest.Mock).mockRejectedValue(new Error('DB Error'));
            await expect(searchForArtistByName('Test')).rejects.toThrow('Error searching for artist by name');
        });
    });

    describe('getArtistByNameApiResp', () => {
        beforeEach(() => {
            jest.spyOn(console, 'log').mockImplementation();
        });

        it('should return success response when found', async () => {
            const mockArtist = { id: '1', name: 'Test Artist' };
            (db.execute as jest.Mock).mockResolvedValue([mockArtist]);

            const result = await getArtistByNameApiResp('Test Artist');
            expect(result.isError).toBe(false);
            expect(result.data).toEqual(mockArtist);
        });

        it('should handle not found and errors', async () => {
            (db.execute as jest.Mock).mockResolvedValue(null);
            const result = await getArtistByNameApiResp('Nonexistent');
            expect(result.isError).toBe(true);
            expect(result.status).toBe(404);
        });
    });
});

describe('User Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getUserById', () => {
        it('should return user when found', async () => {
            const mockUser = { id: '123', wallet: '0x123' };
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);

            const result = await getUserById('123');
            expect(result).toEqual(mockUser);
        });

        it('should handle not found and errors', async () => {
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(undefined);
            const result = await getUserById('nonexistent');
            expect(result).toBeUndefined();

            (db.query.users.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'));
            await expect(getUserById('123')).rejects.toThrow('Error finding user');
        });
    });

    describe('getUserByWallet', () => {
        it('should return user when found by wallet', async () => {
            const mockUser = { id: '123', wallet: '0x123' };
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);

            const result = await getUserByWallet('0x123');
            expect(result).toEqual(mockUser);
        });

        it('should handle not found and errors', async () => {
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(undefined);
            const result = await getUserByWallet('0x999');
            expect(result).toBeUndefined();

            (db.query.users.findFirst as jest.Mock).mockRejectedValue(new Error('DB Error'));
            await expect(getUserByWallet('0x123')).rejects.toThrow('Error finding user');
        });
    });

    describe('getArtistByWalletOrEns', () => {
        it('should search by wallet and fallback to ENS', async () => {
            const mockArtist = { id: '123', ens: 'test.eth' };
            const mockQueryBuilder = {
                select: jest.fn().mockReturnThis(),
                from: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue([])
            };
            (db.select as jest.Mock).mockReturnValue(mockQueryBuilder);
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(mockArtist);

            const result = await getArtistByWalletOrEns('0x123');
            expect(result.isError).toBe(false);
            expect(result.data).toEqual(mockArtist);
        });
    });

    describe('createUser', () => {
        it('should create user successfully', async () => {
            const mockUser = { id: 'user123', wallet: '0x123' };
            (db.insert as jest.Mock).mockReturnValue({
                values: jest.fn().mockReturnValue({
                    returning: jest.fn().mockResolvedValue([mockUser])
                })
            });

            const result = await createUser('0x123');
            expect(result).toEqual(mockUser);
        });

        it('should handle creation errors', async () => {
            (db.insert as jest.Mock).mockReturnValue({
                values: jest.fn().mockReturnValue({
                    returning: jest.fn().mockRejectedValue(new Error('DB Error'))
                })
            });

            await expect(createUser('0x123')).rejects.toThrow('Error creating user');
        });
    });
});

describe('Artist Management Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';
    });

    describe('addArtist', () => {
        const mockSession = { user: { id: 'user123' } };
        const mockUser = { id: 'user123', wallet: '0x123' };
        const mockSpotifyArtist = {
            data: { name: 'Test Artist', id: 'spotify123' },
            error: null
        };

        beforeEach(() => {
            (headers as jest.Mock).mockReturnValue(new Map([['cookie', 'test']]));
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (getSpotifyHeaders as jest.Mock).mockResolvedValue({
                headers: { Authorization: 'Bearer token' }
            });
            (getSpotifyArtist as jest.Mock).mockResolvedValue(mockSpotifyArtist);
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
        });

        it('should add new artist successfully', async () => {
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(null);
            (db.insert as jest.Mock).mockReturnValue({
                values: jest.fn().mockReturnValue({
                    returning: jest.fn().mockResolvedValue([{
                        id: 'artist123',
                        name: 'Test Artist',
                        spotify: 'spotify123'
                    }])
                })
            });

            const result = await addArtist('spotify123');
            expect(result.status).toBe('success');
            expect(result.artistId).toBe('artist123');
        });

        it('should return exists status for existing artist', async () => {
            const existingArtist = { id: 'existing123', name: 'Existing Artist' };
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(existingArtist);

            const result = await addArtist('spotify123');
            expect(result.status).toBe('exists');
        });

        it('should handle authentication and Spotify errors', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            const result = await addArtist('spotify123');
            expect(result.status).toBe('error');
            expect(result.message).toBe('Please log in to add artists');

            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (getSpotifyArtist as jest.Mock).mockResolvedValue({ data: null, error: 'Spotify error' });
            const result2 = await addArtist('spotify123');
            expect(result2.status).toBe('error');
            expect(result2.message).toBe('Spotify error');
        });

        it('should work when wallet requirement is disabled', async () => {
            const originalValue = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT;
            process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            (db.query.artists.findFirst as jest.Mock).mockResolvedValue(null);
            (db.insert as jest.Mock).mockReturnValue({
                values: jest.fn().mockReturnValue({
                    returning: jest.fn().mockResolvedValue([{
                        id: 'artist123',
                        name: 'Test Artist'
                    }])
                })
            });

            const result = await addArtist('spotify123');
            expect(result.status).toBe('success');
            
            // Restore original environment variable
            process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = originalValue;
        });
    });

    describe('addArtistData', () => {
        const mockSession = { user: { id: 'user123' } };
        const mockUser = { id: 'user123', wallet: '0x123', isWhiteListed: false, isAdmin: false };
        const mockArtist: Artist = { ...baseArtist, id: 'artist123', name: 'Test Artist' };

        beforeEach(() => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
            (extractArtistId as jest.Mock).mockResolvedValue({
                id: 'testhandle',
                siteName: 'instagram',
                cardPlatformName: 'Instagram'
            });
            (db.query.ugcresearch.findFirst as jest.Mock).mockResolvedValue(null);
            (db.insert as jest.Mock).mockReturnValue({
                values: jest.fn().mockReturnValue({
                    returning: jest.fn().mockResolvedValue([{ id: 'ugc123' }])
                })
            });
        });

        it('should add data via UGC for regular user', async () => {
            const result = await addArtistData('https://instagram.com/testhandle', mockArtist);
            expect(result.status).toBe('success');
            expect(result.message).toBe("Thanks for adding, we'll review this addition before posting");
        });

        it('should directly update for whitelisted/admin user', async () => {
            const whitelistedUser = { ...mockUser, isWhiteListed: true };
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(whitelistedUser);
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([])
                })
            });

            const result = await addArtistData('https://instagram.com/testhandle', mockArtist);
            expect(result.status).toBe('success');
            expect(result.message).toBe('Artist data has been added successfully');
        });

        it('should handle invalid URL and existing data', async () => {
            (extractArtistId as jest.Mock).mockResolvedValue(null);
            const result = await addArtistData('invalid-url', mockArtist);
            expect(result.status).toBe('error');

            (extractArtistId as jest.Mock).mockResolvedValue({ id: 'test', siteName: 'instagram' });
            (db.query.ugcresearch.findFirst as jest.Mock).mockResolvedValue({ id: 'existing' });
            const result2 = await addArtistData('https://instagram.com/test', mockArtist);
            expect(result2.status).toBe('error');
            expect(result2.message).toBe('This artist data has already been added');
        });

        it('should handle authentication error', async () => {
            // Ensure wallet requirement is enabled for this test
            process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'false';
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            await expect(addArtistData('https://instagram.com/test', mockArtist))
                .rejects.toThrow('Not authenticated');
        });
    });
});

describe('UGC Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getPendingUGC', () => {
        it('should return pending UGC data with user information', async () => {
            const mockUgcData = [
                { id: 'ugc1', ugcUrl: 'https://instagram.com/test1', artistId: 'artist1', ugcUser: { wallet: '0x111' } },
                { id: 'ugc2', ugcUrl: 'https://twitter.com/test2', artistId: 'artist2', ugcUser: null }
            ];
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue(mockUgcData);

            const result = await getPendingUGC();
            expect(result).toHaveLength(2);
            expect(result[0].wallet).toBe('0x111');
            expect(result[1].wallet).toBeNull();
        });

        it('should handle database errors', async () => {
            (db.query.ugcresearch.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));
            await expect(getPendingUGC()).rejects.toThrow('Error finding pending UGC');
        });
    });

    describe('getUgcStats', () => {
        it('should return UGC count for authenticated user', async () => {
            const mockSession = { user: { id: 'user123' } };
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue([{}, {}, {}]);

            const result = await getUgcStats();
            expect(result).toBe(3);
        });

        it('should handle authentication and database errors', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            await expect(getUgcStats()).rejects.toThrow('Not authenticated');

            (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'user123' } });
            (db.query.ugcresearch.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const result = await getUgcStats();
            expect(result).toBeUndefined();
        });
    });

    describe('getUgcStatsInRange', () => {
        const mockSession = { user: { id: 'user123' } };
        const dateRange = { from: new Date('2024-01-01'), to: new Date('2024-01-31') };

        beforeEach(() => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
        });

        it('should return UGC and artist stats for current user', async () => {
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue([{}, {}]);
            (db.query.artists.findMany as jest.Mock).mockResolvedValue([{}]);

            const result = await getUgcStatsInRange(dateRange);
            expect(result).toEqual({ ugcCount: 2, artistsCount: 1 });
        });

        it('should return stats for specific wallet when provided', async () => {
            const mockUser = { id: 'otherUser123' };
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockUser);
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue([{}]);
            (db.query.artists.findMany as jest.Mock).mockResolvedValue([]);

            const result = await getUgcStatsInRange(dateRange, '0x111');
            expect(result).toEqual({ ugcCount: 1, artistsCount: 0 });
        });

        it('should handle authentication and user lookup errors', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            await expect(getUgcStatsInRange(dateRange)).rejects.toThrow('Not authenticated');

            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(null);
            await expect(getUgcStatsInRange(dateRange, '0x999')).rejects.toThrow('User not found');
        });
    });

    describe('approveUgcAdmin', () => {
        const mockSession = { user: { id: 'admin123' } };
        const mockAdminUser = { id: 'admin123', isAdmin: true };

        beforeEach(() => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(mockAdminUser);
            (db.query.ugcresearch.findMany as jest.Mock).mockResolvedValue([
                { id: 'ugc1', artistId: 'artist1', siteName: 'instagram', siteUsername: 'test1' }
            ]);
            (db.execute as jest.Mock).mockResolvedValue([]);
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([])
                })
            });
        });

        it('should approve UGC for admin user', async () => {
            const result = await approveUgcAdmin(['ugc1']);
            expect(result.status).toBe('success');
            expect(result.message).toBe('UGC approved');
        });

        it('should work in walletless mode during development', async () => {
            const originalValue = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT;
            process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = 'true';
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);

            const result = await approveUgcAdmin(['ugc1']);
            expect(result.status).toBe('success');
            
            // Restore original environment variable
            process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT = originalValue;
        });

        it('should handle authentication and authorization errors', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            await expect(approveUgcAdmin(['ugc1'])).rejects.toThrow('Not authenticated');

            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            const nonAdminUser = { ...mockAdminUser, isAdmin: false };
            (db.query.users.findFirst as jest.Mock).mockResolvedValue(nonAdminUser);
            await expect(approveUgcAdmin(['ugc1'])).rejects.toThrow('Not authorized');
        });

        it('should handle database errors', async () => {
            (db.query.ugcresearch.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const result = await approveUgcAdmin(['ugc1']);
            expect(result.status).toBe('error');
            expect(result.message).toBe('Error approving UGC');
        });
    });

    describe('approveUGC', () => {
        beforeEach(() => {
            (db.execute as jest.Mock).mockResolvedValue([]);
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([])
                })
            });
        });

        it('should successfully approve single UGC entry', async () => {
            await approveUGC('ugc1', 'artist1', 'instagram', 'testhandle');
            expect(db.execute).toHaveBeenCalled();
            expect(db.update).toHaveBeenCalled();
        });

        it('should handle database errors', async () => {
            (db.execute as jest.Mock).mockRejectedValue(new Error('DB Error'));
            await expect(approveUGC('ugc1', 'artist1', 'instagram', 'testhandle'))
                .rejects.toThrow('Error approving UGC');
        });
    });
});

describe('Whitelist Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getWhitelistedUsers', () => {
        it('should return whitelisted users when authenticated', async () => {
            const mockSession = { user: { id: 'user123' } };
            const mockUsers = [{ id: 'user1', isWhiteListed: true }];
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (db.query.users.findMany as jest.Mock).mockResolvedValue(mockUsers);

            const result = await getWhitelistedUsers();
            expect(result).toEqual(mockUsers);
        });

        it('should return empty array when no users found', async () => {
            const mockSession = { user: { id: 'user123' } };
            (getServerAuthSession as jest.Mock).mockResolvedValue(mockSession);
            (db.query.users.findMany as jest.Mock).mockResolvedValue(null);

            const result = await getWhitelistedUsers();
            expect(result).toEqual([]);
        });

        it('should handle authentication errors', async () => {
            (getServerAuthSession as jest.Mock).mockResolvedValue(null);
            await expect(getWhitelistedUsers()).rejects.toThrow('Unauthorized');
        });
    });

    describe('addUsersToWhitelist', () => {
        it('should add users to whitelist successfully', async () => {
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([])
                })
            });

            const result = await addUsersToWhitelist(['0x111', '0x222']);
            expect(result.status).toBe('success');
            expect(result.message).toBe('Users added to whitelist');
        });

        it('should handle database errors', async () => {
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockRejectedValue(new Error('DB Error'))
                })
            });

            const result = await addUsersToWhitelist(['0x111']);
            expect(result.status).toBe('error');
            expect(result.message).toBe('Error adding users to whitelist');
        });
    });

    describe('removeFromWhitelist', () => {
        it('should remove users from whitelist', async () => {
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([])
                })
            });

            await removeFromWhitelist(['user1', 'user2']);
            expect(db.update).toHaveBeenCalled();
        });
    });

    describe('updateWhitelistedUser', () => {
        beforeEach(() => {
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([])
                })
            });
        });

        it('should update user data successfully', async () => {
            const updateData = { wallet: '0x123', email: 'test@example.com' };
            const result = await updateWhitelistedUser('user123', updateData);
            expect(result.status).toBe('success');
            expect(result.message).toBe('Whitelist user updated');
        });

        it('should handle validation errors', async () => {
            const result1 = await updateWhitelistedUser('', { wallet: 'test' });
            expect(result1.status).toBe('error');

            const result2 = await updateWhitelistedUser('user123', {});
            expect(result2.status).toBe('error');
            expect(result2.message).toBe('No fields to update');
        });

        it('should handle database errors', async () => {
            (db.update as jest.Mock).mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockRejectedValue(new Error('DB Error'))
                })
            });

            const result = await updateWhitelistedUser('user123', { wallet: 'test' });
            expect(result.status).toBe('error');
        });
    });
});

describe('Utility Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('sendDiscordMessage', () => {
        it('should send message to Discord webhook', async () => {
            (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

            await sendDiscordMessage('Test message');
            expect(axios.post).toHaveBeenCalledWith(
                'https://discord.com/api/webhooks/test',
                { content: 'Test message' }
            );
        });

        it('should handle axios errors gracefully', async () => {
            (axios.post as jest.Mock).mockRejectedValue(new Error('Network error'));
            // Should not throw
            await sendDiscordMessage('Test message');
        });
    });

    describe('getAllSpotifyIds', () => {
        it('should return all Spotify IDs from database', async () => {
            const mockData = [{ spotify: 'id1' }, { spotify: 'id2' }, { spotify: 'id3' }];
            (db.execute as jest.Mock).mockResolvedValue(mockData);

            const result = await getAllSpotifyIds();
            expect(result).toEqual(['id1', 'id2', 'id3']);
        });

        it('should return empty array when database query fails or no IDs found', async () => {
            (db.execute as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const result1 = await getAllSpotifyIds();
            expect(result1).toEqual([]);

            (db.execute as jest.Mock).mockResolvedValue([]);
            const result2 = await getAllSpotifyIds();
            expect(result2).toEqual([]);
        });
    });

    describe('searchForUsersByWallet', () => {
        it('should return matching wallet addresses', async () => {
            const mockUsers = [
                { wallet: '0x1111111111111111111111111111111111111111' },
                { wallet: '0x1122334455667788990011223344556677889900' }
            ];
            (db.query.users.findMany as jest.Mock).mockResolvedValue(mockUsers);

            const result = await searchForUsersByWallet('0x11');
            expect(result).toEqual([
                '0x1111111111111111111111111111111111111111',
                '0x1122334455667788990011223344556677889900'
            ]);
        });

        it('should handle database errors gracefully', async () => {
            (db.query.users.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const result = await searchForUsersByWallet('0x11');
            expect(result).toBeUndefined();
        });
    });
}); 