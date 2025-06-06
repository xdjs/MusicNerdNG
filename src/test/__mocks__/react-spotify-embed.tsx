import React from 'react';
 
export const Spotify = ({ link }: { link: string }) => (
    <div data-testid="spotify-embed" data-link={link}>
        Spotify Embed
    </div>
); 