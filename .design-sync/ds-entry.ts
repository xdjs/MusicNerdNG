// Design-system entry for design-sync (--entry). MusicNerdWeb is a Next.js app, not a published
// component library, so there is no dist/ to point the converter at. This file IS the library
// boundary: it re-exports exactly the components that belong in the design system.
//
// Why hand-written rather than letting the converter synthesize an entry from src/: a synthesized
// entry does `export * from` EVERY source file, which would pull the async server components
// (ArtistLinks, ArtistLinksGrid) — and through them Drizzle, postgres and next-auth — into a
// browser bundle. Those cannot render in a design runtime anyway. Enumerating keeps the bundle
// to real, renderable UI.
//
// Anything added here must also be listed in .design-sync/config.json `componentSrcMap` (that map
// is the component list — there is no .d.ts tree to derive it from).

// ── Primitives: shadcn/ui + Radix (src/components/ui/) ──────────────────────
export { AspectRatio } from "@/components/ui/aspect-ratio";
export { Badge, badgeVariants } from "@/components/ui/badge";
export { Button, buttonVariants } from "@/components/ui/button";
export { Calendar } from "@/components/ui/calendar";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";
export { Checkbox } from "@/components/ui/checkbox";
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "@/components/ui/dropdown-menu";
export {
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
} from "@/components/ui/form";
export { Input } from "@/components/ui/input";
export { Label } from "@/components/ui/label";
export { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "@/components/ui/select";
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
export { Textarea } from "@/components/ui/textarea";
export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
} from "@/components/ui/toast";
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ── Brand components (src/app/_components/) ─────────────────────────────────
// These carry MusicNerd's identity; DESIGN.md: "brand identity is carried by the custom
// components + global utilities, not the primitives."
export { ThemeProvider, useTheme } from "@/app/_components/ThemeProvider";
export { ThemeToggle } from "@/app/_components/ThemeToggle";
export { EditModeContext, EditModeProvider } from "@/app/_components/EditModeContext";

export { default as EditModeToggle } from "@/app/_components/EditModeToggle";
export { default as BookmarkButton } from "@/app/_components/BookmarkButton";
export { default as Footer } from "@/app/_components/Footer";
export { default as LoadingPage } from "@/app/_components/LoadingPage";
export { default as PleaseLoginPage } from "@/app/_components/PleaseLoginPage";
export { default as SlidingText } from "@/app/_components/SlidingText";
export { default as TypeWriter } from "@/app/_components/TypeWriter";

// DELIBERATELY NOT EXPORTED: HomePageSplash.
// It is the whole homepage — the "music nerd" wordmark PLUS ActivityFeed. ActivityFeed imports
// next/link, whose module scope reads Next-internal `process.env.__NEXT_*` globals that only exist
// because the Next compiler substitutes them at build time. In a plain browser bundle that is a
// hard `ReferenceError: process is not defined` at IIFE init, which took down all 29 components,
// not just this one. ActivityFeed also fetches /api/activity, which no design runtime can serve.
// Shipping it would drag Next's router internals into every rendered design to display a
// permanently-empty feed. The wordmark itself is pure inline-styled markup, so it is documented
// as a copyable recipe in .design-sync/conventions.md instead.
