import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
} from "musicnerdweb";

/**
 * The profile "My entries" table (`src/app/profile/UserEntriesTable.tsx`): one row per
 * UGC submission — date, artist, platform, submitted URL, status.
 *
 * Note this Table is NOT stock shadcn: `TableCell` carries
 * `whitespace-nowrap overflow-hidden text-ellipsis` and tighter `p-2` padding
 * (stock is `p-4`, wrapping). Every cell truncates rather than wraps.
 */
export const Default = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="w-[110px]">Date</TableHead>
        <TableHead>Artist</TableHead>
        <TableHead>Platform</TableHead>
        <TableHead>Submitted URL</TableHead>
        <TableHead className="text-right">Status</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {[
        ["Jul 09, 2026", "Jamie xx", "Spotify", "https://open.spotify.com/artist/2SBRfBHOwGKA8fdQrRAtc4", "Approved"],
        ["Jul 08, 2026", "Floating Points", "Bandcamp", "https://floatingpoints.bandcamp.com/album/cascade", "Approved"],
        ["Jul 08, 2026", "Yaeji", "SoundCloud", "https://soundcloud.com/kraeji", "Pending"],
        ["Jul 06, 2026", "Overmono", "Apple Music", "https://music.apple.com/us/artist/overmono/1113641144", "Approved"],
      ].map(([date, artist, platform, url, status]) => (
        <TableRow key={url}>
          <TableCell className="text-muted-foreground">{date}</TableCell>
          <TableCell className="font-medium">{artist}</TableCell>
          <TableCell>{platform}</TableCell>
          <TableCell className="text-muted-foreground">{url}</TableCell>
          <TableCell className="text-right">
            <Badge variant={status === "Approved" ? "secondary" : "outline"}>{status}</Badge>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/**
 * Truncation, on purpose. The same MusicBrainz/Deezer URL in three columns of decreasing
 * width: it silently loses its tail rather than wrapping to a second line. This is the most
 * consequential deviation from stock shadcn Table — and it only bites under `table-fixed`,
 * since in the default auto layout the table just widens to fit and no cell ever clips.
 */
export const TruncatingCells = () => (
  <Table style={{ tableLayout: "fixed" }}>
    <TableHeader>
      <TableRow>
        <TableHead style={{ width: 100 }}>Artist</TableHead>
        <TableHead style={{ width: 130 }}>narrow</TableHead>
        <TableHead style={{ width: 210 }}>medium</TableHead>
        <TableHead>wide</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {[
        ["Kelela", "https://musicbrainz.org/artist/9e4b8d5f-9c15-4b31-a2f6-72d0e4e19b21"],
        ["Four Tet", "https://www.deezer.com/en/artist/1147?utm_source=musicnerd"],
      ].map(([artist, url]) => (
        <TableRow key={artist}>
          <TableCell className="font-medium">{artist}</TableCell>
          <TableCell className="text-muted-foreground">{url}</TableCell>
          <TableCell className="text-muted-foreground">{url}</TableCell>
          <TableCell className="text-muted-foreground">{url}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/**
 * The full compound: Caption + Header + Body + Footer, with a selected row
 * (`data-[state=selected]:bg-muted`) — the admin moderation queue pattern. Footer is
 * `bg-muted/50 font-medium` and is the only place a total belongs.
 */
export const WithFooterAndSelection = () => (
  <Table>
    <TableCaption>Cross-platform ID mapping coverage — agent run #48</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Platform</TableHead>
        <TableHead className="text-right">Mapped</TableHead>
        <TableHead className="text-right">Excluded</TableHead>
        <TableHead className="text-right">Coverage</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell className="font-medium">Deezer</TableCell>
        <TableCell className="text-right">12,480</TableCell>
        <TableCell className="text-right">312</TableCell>
        <TableCell className="text-right">86%</TableCell>
      </TableRow>
      <TableRow data-state="selected">
        <TableCell className="font-medium">Apple Music</TableCell>
        <TableCell className="text-right">9,104</TableCell>
        <TableCell className="text-right">844</TableCell>
        <TableCell className="text-right">63%</TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">MusicBrainz</TableCell>
        <TableCell className="text-right">13,902</TableCell>
        <TableCell className="text-right">96</TableCell>
        <TableCell className="text-right">95%</TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Tidal</TableCell>
        <TableCell className="text-right">4,331</TableCell>
        <TableCell className="text-right">1,207</TableCell>
        <TableCell className="text-right">30%</TableCell>
      </TableRow>
    </TableBody>
    <TableFooter>
      <TableRow>
        <TableCell>Total</TableCell>
        <TableCell className="text-right">39,817</TableCell>
        <TableCell className="text-right">2,459</TableCell>
        <TableCell className="text-right">68%</TableCell>
      </TableRow>
    </TableFooter>
  </Table>
);
