-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"email" text,
	"username" text,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	"legacy_id" text,
	CONSTRAINT "users_wallet_key" UNIQUE("wallet")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artists" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"legacy_id" text,
	"bandcamp" text,
	"facebook" text,
	"twitter" text,
	"soundcloud" text,
	"notes" text,
	"patreon" text,
	"name" text,
	"instagram" text,
	"youtube" text,
	"youtubechannel" text,
	"lcname" text,
	"soundcloudID" integer,
	"spotify" text,
	"twitch" text,
	"imdb" text,
	"musicbrainz" text,
	"wikidata" text,
	"mixcloud" text,
	"facebookID" text,
	"discogs" text,
	"tiktok" text,
	"tiktokID" text,
	"jaxsta" text,
	"famousbirthdays" text,
	"songexploder" text,
	"colorsxstudios" text,
	"bandsintown" text,
	"linktree" text,
	"onlyfans" text,
	"wikipedia" text,
	"audius" text,
	"zora" text,
	"catalog" text,
	"opensea" text,
	"foundation" text,
	"lastfm" text,
	"linkedin" text,
	"soundxyz" text,
	"mirror" text,
	"glassnode" text,
	"collectsNFTs" boolean,
	"spotifyusername" text,
	"bandcampfan" text,
	"tellie" text,
	"wallets" text[],
	"ens" text,
	"lens" text,
	"addedBy" uuid,
	"cameo" text,
	"farcaster" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "urlmap" (
	"id" uuid DEFAULT uuid_generate_v4(),
	"siteurl" text NOT NULL,
	"sitename" text NOT NULL,
	"example" text NOT NULL,
	"appstingformat" text NOT NULL,
	"cardorder" integer,
	"isiframeenabled" boolean DEFAULT false NOT NULL,
	"isembedenabled" boolean DEFAULT false NOT NULL,
	"carddescription" text NOT NULL,
	"cardplatformname" text NOT NULL,
	"isweb3site" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
	CONSTRAINT "urlmap_siteurl_key" UNIQUE("siteurl"),
	CONSTRAINT "urlmap_sitename_key" UNIQUE("sitename"),
	CONSTRAINT "urlmap_example_key" UNIQUE("example"),
	CONSTRAINT "urlmap_appstingformat_key" UNIQUE("appstingformat")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "featured" (
	"id" uuid DEFAULT uuid_generate_v4(),
	"featuredartist" uuid,
	"featuredcollector" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ugcresearch" (
	"id" uuid DEFAULT uuid_generate_v4(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"artistURI" text,
	"accepted" boolean,
	"ugcURL" text,
	"siteName" text,
	"siteUsername" text,
	"artistID" uuid,
	"dateProcessed" timestamp,
	"name" text,
	"userID" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ugcwhitelist" (
	"userid" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artists" ADD CONSTRAINT "artists_addedby_fkey" FOREIGN KEY ("addedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ugcresearch" ADD CONSTRAINT "ugcresearch_artistID_fkey" FOREIGN KEY ("artistID") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ugcresearch" ADD CONSTRAINT "ugcresearch_userID_fkey" FOREIGN KEY ("userID") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ugcwhitelist" ADD CONSTRAINT "ugcwhitelist_userid_fkey" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

*/