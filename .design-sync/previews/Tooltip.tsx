import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "musicnerdweb";

/**
 * TooltipContent is portaled and `fixed`, and hover never happens in a headless capture — so
 * the Tooltip is forced `open` and wrapped in the required TooltipProvider. Positioning is
 * left to Radix; the card viewport is what makes it fit.
 *
 * Content copied in spirit from the artist-page fun-facts buttons, which are the repo's only
 * Tooltip consumers (a one-line description under each prompt button).
 */
export const Open = () => (
  <TooltipProvider>
    <div className="flex min-h-[240px] items-start justify-center pt-6">
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm">
            Surprise me
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="whitespace-nowrap">
          <p>An unexpected fact about this artist</p>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);

/**
 * Tooltip anchored to the side, on an icon-only trigger — the pattern used for the small
 * platform-link icons on the artist page, where the label has nowhere else to live.
 */
export const OnIconTrigger = () => (
  <TooltipProvider>
    <div className="flex min-h-[240px] items-center justify-center">
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Bandcamp">
            <span className="text-sm font-semibold">B</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          <p>Open on Bandcamp</p>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
