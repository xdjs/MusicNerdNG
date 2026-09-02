import { absoluteImageUrl, customImageUrl } from '@/lib/artistImage';

describe('customImageUrl', () => {
    it('returns null when the artist has not set one', () => {
        expect(customImageUrl(null)).toBeNull();
        expect(customImageUrl(undefined)).toBeNull();
    });

    it('treats empty and whitespace-only values as unset', () => {
        // custom_image has historically held '' as well as NULL, so a plain
        // null-check would hand an empty string on to the <img> tag.
        expect(customImageUrl('')).toBeNull();
        expect(customImageUrl('   ')).toBeNull();
    });

    it('returns the trimmed value when set', () => {
        expect(customImageUrl('  https://cdn.example/a.png  ')).toBe('https://cdn.example/a.png');
    });
});

describe('absoluteImageUrl', () => {
    it('leaves an already-absolute storage URL alone', () => {
        // The bug this guards: prefixing the site origin onto a Supabase Storage
        // URL produced https://www.musicnerd.xyzhttps://xyz.supabase.co/...
        const stored = 'https://kyhlkqriyvevjqtufidu.supabase.co/storage/v1/object/public/vault/profile-images/a_1.png';
        expect(absoluteImageUrl(stored)).toBe(stored);
    });

    it('leaves plain http URLs alone too', () => {
        expect(absoluteImageUrl('http://cdn.example/a.png')).toBe('http://cdn.example/a.png');
    });

    it('prefixes the site origin onto a site-relative path', () => {
        expect(absoluteImageUrl('/uploads/a.png')).toBe('https://www.musicnerd.xyz/uploads/a.png');
    });

    it('adds the missing slash on a bare relative path', () => {
        expect(absoluteImageUrl('uploads/a.png')).toBe('https://www.musicnerd.xyz/uploads/a.png');
    });

    it('accepts a different origin', () => {
        expect(absoluteImageUrl('/a.png', 'https://staging.musicnerd.xyz')).toBe('https://staging.musicnerd.xyz/a.png');
    });
});
