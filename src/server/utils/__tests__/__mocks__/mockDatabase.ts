import { Artist } from '@/server/db/DbTypes';
import { artists } from '@/server/db/schema';

// Type definitions for our mocked database operations
type MockDBReturn<T> = {
    values: (data: Partial<T>) => {
        returning: () => Promise<T[]>;
    };
};

// Create a properly typed mock database
export const createMockDB = () => {
    const mockArtists: Artist[] = [];
    const mockUsers: any[] = [
        {
            id: 'test-user-id',
            wallet: 'test-wallet'
        }
    ];

    return {
        query: {
            artists: {
                findFirst: jest.fn(async ({ where } = {}) => {
                    if (!where) return undefined;
                    // Basic implementation to match spotify ID
                    return mockArtists.find(artist => artist.spotify === where.spotify?._value);
                }),
                findMany: jest.fn(async () => mockArtists)
            },
            users: {
                findFirst: jest.fn(async ({ where } = {}) => {
                    if (!where) return undefined;
                    return mockUsers.find(user => user.id === where.id?._value);
                }),
                findMany: jest.fn(async () => mockUsers)
            }
        },
        insert: jest.fn((table) => {
            if (table === artists) {
                return {
                    values: (data: Partial<Artist>) => ({
                        returning: async () => {
                            const newArtist = {
                                ...data,
                                id: 'test-id',
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString()
                            } as Artist;
                            mockArtists.push(newArtist);
                            return [newArtist];
                        }
                    })
                } as MockDBReturn<Artist>;
            }
            throw new Error('Unsupported table');
        })
    };
};

// Helper to create a mock artist
export const createMockArtist = (id: string, name: string, spotify: string): Artist => ({
    id,
    name,
    spotify,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    legacyId: null,
    bandcamp: null,
    facebook: null,
    x: null,
    soundcloud: null,
    youtube: null,
    instagram: null,
    tiktok: null,
    supercollector: null,
    notes: null,
    patreon: null,
    youtubechannel: null,
    lcname: name.toLowerCase(),
    wikipedia: null,
    twitch: null,
    linktree: null,
    foundation: null,
    opensea: null,
    audius: null,
    zora: null,
    catalog: null,
    mirror: null,
    soundcloudId: null,
    imdb: null,
    musicbrainz: null,
    wikidata: null,
    mixcloud: null,
    facebookId: null,
    discogs: null,
    tiktokId: null,
    jaxsta: null,
    famousbirthdays: null,
    songexploder: null,
    colorsxstudios: null,
    bandsintown: null,
    onlyfans: null,
    lastfm: null,
    linkedin: null,
    soundxyz: null,
    glassnode: null,
    collectsNfTs: null,
    spotifyusername: null,
    bandcampfan: null,
    tellie: null,
    wallets: [],
    ens: null,
    lens: null,
    addedBy: 'test-user-id',
    cameo: null,
    farcaster: null,
    bio: null
});

// Basic tests to verify mock functionality
describe('mockDatabase', () => {
    it('should find user by ID', async () => {
        const db = createMockDB();
        const user = await db.query.users.findFirst({ where: { id: { _value: 'test-user-id' } } });
        expect(user).toBeTruthy();
        expect(user.id).toBe('test-user-id');
    });

    it('should insert and find artist', async () => {
        const db = createMockDB();
        const artistData = {
            name: 'Test Artist',
            spotify: 'test-spotify-id',
            addedBy: 'test-user-id'
        };

        const [insertedArtist] = await db.insert(artists)
            .values(artistData)
            .returning();

        expect(insertedArtist).toBeTruthy();
        expect(insertedArtist.name).toBe('Test Artist');

        const foundArtist = await db.query.artists.findFirst({
            where: { spotify: { _value: 'test-spotify-id' } }
        });
        expect(foundArtist).toBeTruthy();
        expect(foundArtist?.name).toBe('Test Artist');
    });
}); 