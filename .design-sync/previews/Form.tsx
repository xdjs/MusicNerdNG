import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "musicnerdweb";

/**
 * `Form` is just react-hook-form's `FormProvider` re-exported — it renders no DOM. What the
 * design system actually owns is the FormItem / FormLabel / FormControl / FormDescription /
 * FormMessage stack: `space-y-2` between parts, `text-sm text-muted-foreground` for the
 * description, `text-sm font-medium text-destructive` for the message, and FormLabel
 * flipping to `text-destructive` when the field has an error.
 *
 * NOTE the Input here carries hand-added chrome (`h-10 rounded-md border border-input`).
 * FormControl does not supply any — and the base Input has no border or height — so a
 * literal port of AddArtist.tsx (`<Input {...field} />`) renders an invisible field.
 */
export const Default = () => {
  const form = useForm({
    defaultValues: { artistUrl: "https://open.spotify.com/artist/2VZNmg3v9nbVMnRkZadyi5" },
  });

  return (
    <Form {...form}>
      <form className="w-full max-w-lg space-y-6">
        <FormField
          control={form.control}
          name="artistUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Artist URL</FormLabel>
              <FormControl>
                <Input
                  placeholder="Paste a Spotify or Deezer artist URL"
                  className="h-10 rounded-md border border-input px-3 py-2"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Copy the URL from the artist&apos;s Spotify or Deezer page.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="button" className="bg-pastypink text-white hover:bg-pastypink/90">
          Add artist
        </Button>
      </form>
    </Form>
  );
};

/**
 * The error state — the whole reason FormMessage exists. FormLabel turns `text-destructive`,
 * FormMessage prints the resolver message, and FormControl sets `aria-invalid`.
 *
 * The error is injected with `setError` in an effect because a static render never runs a
 * submit; this is exactly the state a failed urlmap regex check produces.
 */
export const WithError = () => {
  const form = useForm({ defaultValues: { artistUrl: "sondcloud.com/arca1000000" } });

  React.useEffect(() => {
    form.setError("artistUrl", {
      type: "manual",
      message: "That host doesn't match any platform in urlmap.",
    });
  }, [form]);

  const error = form.formState.errors.artistUrl;

  return (
    <Form {...form}>
      <form className="w-full max-w-lg space-y-6">
        <FormField
          control={form.control}
          name="artistUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Artist URL</FormLabel>
              <FormControl>
                <Input
                  className={`h-10 rounded-md border px-3 py-2 ${
                    error ? "border-destructive" : "border-input"
                  }`}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Supported: Spotify, Deezer, Bandcamp, SoundCloud, Apple Music.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="button" className="bg-pastypink text-white hover:bg-pastypink/90">
          Add artist
        </Button>
      </form>
    </Form>
  );
};

/**
 * A multi-field form, which is where the `space-y-2` inside FormItem and the outer field
 * rhythm actually get tested. Mixes Input and Textarea controls through FormControl's Slot.
 */
export const MultiField = () => {
  const form = useForm({
    defaultValues: {
      label: "id-mapping-agent",
      spotifyUrl: "https://open.spotify.com/artist/6UBAOAqvpz7GwxLIleJm3O",
      notes: "",
    },
  });

  return (
    <Form {...form}>
      <form className="w-full max-w-lg space-y-5">
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Key label</FormLabel>
              <FormControl>
                <Input
                  className="h-10 rounded-md border border-input px-3 py-2"
                  {...field}
                />
              </FormControl>
              <FormDescription>Shown in the MCP audit log for every write.</FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="spotifyUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Spotify artist URL</FormLabel>
              <FormControl>
                <Input
                  className="h-10 rounded-md border border-input px-3 py-2"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reviewer notes</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Why is this mapping high-confidence?"
                  className="min-h-[80px]"
                  {...field}
                />
              </FormControl>
              <FormDescription>Optional — attached to the UGC submission.</FormDescription>
            </FormItem>
          )}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline">
            Cancel
          </Button>
          <Button type="button" className="bg-pastypink text-white hover:bg-pastypink/90">
            Submit
          </Button>
        </div>
      </form>
    </Form>
  );
};
