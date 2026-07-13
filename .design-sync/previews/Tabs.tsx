import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "musicnerdweb";

/**
 * The admin dashboard nav (`src/app/admin/AdminTabs.tsx`) — six sections, pending counts
 * baked into the trigger labels. `defaultValue` is required or no panel renders.
 * Stock shadcn/Radix: `bg-muted` rail, active trigger lifts to `bg-background` + shadow-sm.
 */
export const Default = () => (
  <Tabs defaultValue="ugc" className="w-[620px]">
    <TabsList>
      <TabsTrigger value="ugc">UGC (14)</TabsTrigger>
      <TabsTrigger value="claims">Claims (3)</TabsTrigger>
      <TabsTrigger value="artist-data">Artist Data</TabsTrigger>
      <TabsTrigger value="users">Users</TabsTrigger>
      <TabsTrigger value="mcp-keys">MCP Keys</TabsTrigger>
      <TabsTrigger value="agent-work">Agent Work</TabsTrigger>
    </TabsList>
    <TabsContent value="ugc">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Artist</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Contributor</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ["Yaeji", "Bandcamp", "vinylwitch"],
            ["Overmono", "Deezer", "bpmhunter"],
            ["Kelela", "SoundCloud", "crate.digger"],
          ].map(([artist, platform, who]) => (
            <TableRow key={artist}>
              <TableCell className="font-medium">{artist}</TableCell>
              <TableCell>{platform}</TableCell>
              <TableCell className="text-muted-foreground">@{who}</TableCell>
              <TableCell className="text-right">
                <Badge variant="outline">Pending</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TabsContent>
    <TabsContent value="claims">Claims queue</TabsContent>
    <TabsContent value="artist-data">Artist data tools</TabsContent>
    <TabsContent value="users">User directory</TabsContent>
    <TabsContent value="mcp-keys">MCP API keys</TabsContent>
    <TabsContent value="agent-work">Agent activity</TabsContent>
  </Tabs>
);

/**
 * A different tab selected (`defaultValue="agent-work"`, the last trigger), proving the
 * active-state axis: only the selected trigger gets `bg-background text-foreground shadow-sm`;
 * the rest stay `text-muted-foreground` on the muted rail.
 */
export const SecondPanelActive = () => (
  <Tabs defaultValue="agent-work" className="w-[620px]">
    <TabsList>
      <TabsTrigger value="ugc">UGC (14)</TabsTrigger>
      <TabsTrigger value="claims">Claims (3)</TabsTrigger>
      <TabsTrigger value="artist-data">Artist Data</TabsTrigger>
      <TabsTrigger value="users">Users</TabsTrigger>
      <TabsTrigger value="mcp-keys">MCP Keys</TabsTrigger>
      <TabsTrigger value="agent-work">Agent Work</TabsTrigger>
    </TabsList>
    <TabsContent value="ugc">UGC queue</TabsContent>
    <TabsContent value="agent-work">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Deezer", "12,480", "86% coverage"],
          ["Apple Music", "9,104", "63% coverage"],
          ["MusicBrainz", "13,902", "95% coverage"],
        ].map(([platform, mapped, note]) => (
          <div key={platform} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{platform}</p>
            <p className="text-2xl font-semibold">{mapped}</p>
            <p className="text-xs text-muted-foreground">{note}</p>
          </div>
        ))}
      </div>
    </TabsContent>
  </Tabs>
);

/**
 * Two triggers, one disabled (`disabled:opacity-50`) — the artist page's Bio / Fun Facts
 * split before the AI content has generated. Also the narrow, non-admin shape of the
 * component: a short rail rather than a six-way one.
 */
export const TwoUpWithDisabled = () => (
  <Tabs defaultValue="bio" className="w-[420px]">
    <TabsList>
      <TabsTrigger value="bio">Bio</TabsTrigger>
      <TabsTrigger value="fun-facts" disabled>
        Fun Facts
      </TabsTrigger>
    </TabsList>
    <TabsContent value="bio">
      <div className="rounded-lg border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        Floating Points is the project of Sam Shepherd — a London producer whose work moves
        between modal jazz, broken house, and orchestral composition.
      </div>
    </TabsContent>
    <TabsContent value="fun-facts">Not generated yet.</TabsContent>
  </Tabs>
);
