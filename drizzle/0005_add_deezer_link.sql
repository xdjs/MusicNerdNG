ALTER TABLE "artists" ADD COLUMN "deezer" text;--> statement-breakpoint

-- Upsert the Deezer entry in urlmap so the artist profile renders the correct
-- icon and links to https://www.deezer.com/artist/<id> instead of a relative path.
INSERT INTO "urlmap" (
  "site_url",
  "site_name",
  "example",
  "app_string_format",
  "card_description",
  "card_platform_name",
  "is_web3_site",
  "site_image",
  "regex",
  "is_monetized",
  "color_hex",
  "platform_type_list"
) VALUES (
  'deezer.com',
  'deezer',
  'https://www.deezer.com/artist/12345',
  'https://www.deezer.com/artist/%@',
  'Listen on %@',
  'Deezer',
  false,
  '/siteIcons/deezer_icon.svg',
  '^https?://(?:www\.)?deezer\.com/(?:[a-z]{2}/)?artist/(\d+)',
  false,
  '#A238FF',
  ARRAY['listen']::platform_type[]
)
ON CONFLICT ("site_name") DO UPDATE SET
  "site_url" = EXCLUDED."site_url",
  "example" = EXCLUDED."example",
  "app_string_format" = EXCLUDED."app_string_format",
  "card_description" = EXCLUDED."card_description",
  "card_platform_name" = EXCLUDED."card_platform_name",
  "is_web3_site" = EXCLUDED."is_web3_site",
  "site_image" = EXCLUDED."site_image",
  "regex" = EXCLUDED."regex",
  "is_monetized" = EXCLUDED."is_monetized",
  "color_hex" = EXCLUDED."color_hex",
  "platform_type_list" = EXCLUDED."platform_type_list",
  "updated_at" = now();
