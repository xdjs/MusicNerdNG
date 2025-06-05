import React from 'react';

export default function ArtistLinks({ links }: { links: Record<string, string | null> }) {
    return (
        <div data-testid="artist-links">
            {Object.entries(links).map(([platform, link]) => (
                link && (
                    <div key={platform} data-testid={`artist-link-${platform}`}>
                        {platform}: {link}
                    </div>
                )
            ))}
        </div>
    );
} 