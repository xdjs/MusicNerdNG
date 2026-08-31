// @ts-nocheck
import { jest } from '@jest/globals';

const rows = [
    // The three people who went to @breath.church together, each handed the
    // venue as their job by the extractor.
    { kind: 'credit', subject: 'zavodskyalan', isHandle: true, isSelf: false, label: 'breath church',
      quote: 'Then I went to NY to do my very first @breath.church with @sage.breath and the boys @zavodskyalan',
      sourceUrl: 'https://www.instagram.com/p/A/', postedAt: null },
    // A real credit from the same feed, which must survive.
    { kind: 'credit', subject: 'zavodskyalan', isHandle: true, isSelf: false, label: 'main production partner',
      quote: 'He has been one of my main production partners for years now',
      sourceUrl: 'https://www.instagram.com/p/B/', postedAt: null },
    { kind: 'statement', subject: null, isHandle: false, isSelf: false, label: 'the pandemic',
      quote: 'a blessing and a curse', sourceUrl: 'https://www.instagram.com/p/C/', postedAt: null },
];

jest.mock('@/server/db/drizzle', () => ({
    db: { select: () => ({ from: () => ({ where: async () => rows }) }) },
}));

describe('getSocialCredits', () => {
    beforeEach(() => { jest.resetModules(); });

    it('drops a stored role that is really somebody else\'s handle, without a re-extraction', async () => {
        // The extractor refuses these now, but rows written before that fix are
        // still in the table and re-reading a 300-post feed is a seven-minute
        // job. Nobody should have to run it to stop being told wrong things —
        // so the filter applies on the way OUT as well as the way in.
        const { getSocialCredits } = await import('../socialCreditQueries');
        const out = await getSocialCredits('a1');

        expect(out.credits.map(c => c.role)).toEqual(['main production partner']);
        expect(out.statements).toHaveLength(1);   // statements are untouched
    });
});
