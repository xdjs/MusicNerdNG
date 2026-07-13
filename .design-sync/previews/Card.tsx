import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Badge,
} from "musicnerdweb";

/**
 * The canonical compound: Header (Title + Description) → Content → Footer.
 * Card is stock shadcn — `rounded-lg border bg-card shadow-sm`, every section on `p-6`.
 */
export const Default = () => (
  <Card className="max-w-sm">
    <CardHeader>
      <CardTitle>Jamie xx</CardTitle>
      <CardDescription>
        Electronic producer and DJ. 14 platform links collected by the community.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">electronic</Badge>
        <Badge variant="secondary">house</Badge>
        <Badge variant="outline">uk</Badge>
      </div>
    </CardContent>
    <CardFooter className="gap-2">
      <Button size="sm">Open artist</Button>
      <Button size="sm" variant="outline">
        Edit links
      </Button>
    </CardFooter>
  </Card>
);

/**
 * Header + Content only — the shape the leaderboard and admin tables use.
 * Note the mauve title color (`#9b83a0`), applied as a literal at the call site;
 * DESIGN.md flags this micro-palette as un-tokenized design debt.
 */
export const Sectioned = () => (
  <Card className="max-w-md shadow-2xl">
    <CardHeader className="text-center">
      <CardTitle className="text-[#9b83a0]">Leaderboard</CardTitle>
      <CardDescription>Top contributors this week</CardDescription>
    </CardHeader>
    <CardContent>
      <ol className="space-y-2 text-sm">
        {[
          ["1", "vinylwitch", "142"],
          ["2", "bpmhunter", "118"],
          ["3", "crate.digger", "97"],
        ].map(([rank, name, points]) => (
          <li
            key={rank}
            className="flex items-center justify-between border-b pb-2 last:border-b-0"
          >
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground">{rank}</span>
              <span className="font-medium">{name}</span>
            </span>
            <span className="text-muted-foreground">{points} pts</span>
          </li>
        ))}
      </ol>
    </CardContent>
  </Card>
);

/**
 * The competing surface language. DESIGN.md: the codebase mostly uses the custom
 * `.glass` panel (`glass p-4 sm:p-5 space-y-3`, 16px radius) rather than Card for primary
 * layout — two padding conventions coexist. Shown side by side so the difference is a
 * deliberate choice, not an accident.
 */
export const CardVsGlassPanel = () => (
  // The brand wash is load-bearing here, not decoration: `.glass` is rgba(255,255,255,0.55)
  // with a backdrop-filter, so on a plain white page it is literally invisible. It only reads
  // as glass over color — which is how it always appears in the app (over the hero gradient
  // and artist imagery). Card, being opaque `bg-card`, looks identical on any backdrop.
  <div className="rounded-2xl bg-gradient-to-br from-pastypink via-[#7c3aed] to-pastyblue p-6">
    <div className="flex flex-wrap items-start gap-4">
      <Card className="w-64">
        <CardHeader>
          <CardTitle className="text-lg">shadcn Card</CardTitle>
          <CardDescription>Opaque bg-card, rounded-lg (8px), p-6</CardDescription>
        </CardHeader>
      </Card>
      <div className="glass w-64 space-y-3 p-4 sm:p-5">
        <h3 className="text-lg font-semibold leading-none tracking-tight text-maroon">
          .glass panel
        </h3>
        <p className="text-sm text-maroon/80">
          Translucent, blur(20px) saturate(180%), 16px radius — the primary surface.
        </p>
      </div>
    </div>
  </div>
);
