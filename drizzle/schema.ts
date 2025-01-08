import { pgTable, foreignKey, uuid, timestamp, unique, text, integer, boolean } from "drizzle-orm/pg-core"
  import { sql } from "drizzle-orm"




export const ugcwhitelist = pgTable("ugcwhitelist", {
	userId: uuid("user_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ugcwhitelistUserIdFkey: foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ugcwhitelist_user_id_fkey"
		}),
	}
});

export const urlmap = pgTable("urlmap", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	siteUrl: text("site_url").notNull(),
	siteName: text("site_name").notNull(),
	example: text("example").notNull(),
	appStringFormat: text("app_string_format").notNull(),
	cardOrder: integer("card_order"),
	isIframeEnabled: boolean("is_iframe_enabled").default(false).notNull(),
	isEmbedEnabled: boolean("is_embed_enabled").default(false).notNull(),
	cardDescription: text("card_description"),
	cardPlatformName: text("card_platform_name"),
	isWeb3Site: boolean("is_web3_site").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`),
	siteImage: text("site_image"),
	regex: text("regex").default('""').notNull(),
	regexMatcher: text("regex_matcher"),
	isMonetized: boolean("is_monetized").default(false).notNull(),
},
(table) => {
	return {
		urlmapSiteurlKey: unique("urlmap_siteurl_key").on(table.siteUrl),
		urlmapExampleKey: unique("urlmap_example_key").on(table.example),
		urlmapAppstingformatKey: unique("urlmap_appstingformat_key").on(table.appStringFormat),
	}
});

export const featured = pgTable("featured", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	featuredArtist: uuid("featured_artist"),
	featuredCollector: uuid("featured_collector"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
},
(table) => {
	return {
		featuredFeaturedArtistFkey: foreignKey({
			columns: [table.featuredArtist],
			foreignColumns: [artists.id],
			name: "featured_featured_artist_fkey"
		}),
		featuredFeaturedCollectorFkey: foreignKey({
			columns: [table.featuredCollector],
			foreignColumns: [artists.id],
			name: "featured_featured_collector_fkey"
		}),
	}
});

export const users = pgTable("users", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	email: text("email"),
	username: text("username"),
	wallet: text("wallet").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	legacyId: text("legacy_id"),
	isAdmin: boolean("is_admin").default(false).notNull(),
	isWhiteListed: boolean("is_white_listed").default(false).notNull(),
	isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
},
(table) => {
	return {
		usersWalletKey: unique("users_wallet_key").on(table.wallet),
	}
});

export const artists = pgTable("artists", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	legacyId: text("legacy_id"),
	bandcamp: text("bandcamp"),
	facebook: text("facebook"),
	twitter: text("twitter"),
	soundcloud: text("soundcloud"),
	notes: text("notes"),
	patreon: text("patreon"),
	name: text("name"),
	instagram: text("instagram"),
	youtube: text("youtube"),
	youtubechannel: text("youtubechannel"),
	lcname: text("lcname"),
	soundcloudId: integer("soundcloudID"),
	spotify: text("spotify"),
	twitch: text("twitch"),
	imdb: text("imdb"),
	musicbrainz: text("musicbrainz"),
	wikidata: text("wikidata"),
	mixcloud: text("mixcloud"),
	facebookId: text("facebookID"),
	discogs: text("discogs"),
	tiktok: text("tiktok"),
	tiktokId: text("tiktokID"),
	jaxsta: text("jaxsta"),
	famousbirthdays: text("famousbirthdays"),
	songexploder: text("songexploder"),
	colorsxstudios: text("colorsxstudios"),
	bandsintown: text("bandsintown"),
	linktree: text("linktree"),
	onlyfans: text("onlyfans"),
	wikipedia: text("wikipedia"),
	audius: text("audius"),
	zora: text("zora"),
	catalog: text("catalog"),
	opensea: text("opensea"),
	foundation: text("foundation"),
	lastfm: text("lastfm"),
	linkedin: text("linkedin"),
	soundxyz: text("soundxyz"),
	mirror: text("mirror"),
	glassnode: text("glassnode"),
	collectsNfTs: boolean("collectsNFTs"),
	spotifyusername: text("spotifyusername"),
	bandcampfan: text("bandcampfan"),
	tellie: text("tellie"),
	wallets: text("wallets").array(),
	ens: text("ens"),
	lens: text("lens"),
	addedBy: uuid("added_by"),
	cameo: text("cameo"),
	farcaster: text("farcaster"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
},
(table) => {
	return {
		artistsAddedByFkey: foreignKey({
			columns: [table.addedBy],
			foreignColumns: [users.id],
			name: "artists_added_by_fkey"
		}),
	}
});

export const ugcresearch = pgTable("ugcresearch", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	artistUri: text("artist_uri"),
	accepted: boolean("accepted").default(false),
	ugcUrl: text("ugc_url"),
	siteName: text("site_name"),
	siteUsername: text("site_username"),
	artistId: uuid("artist_id"),
	dateProcessed: timestamp("date_processed", { mode: 'string' }),
	name: text("name"),
	userId: uuid("user_id"),
},
(table) => {
	return {
		ugcresearchArtistIdFkey: foreignKey({
			columns: [table.artistId],
			foreignColumns: [artists.id],
			name: "ugcresearch_artist_id_fkey"
		}),
		ugcresearchUserIdFkey: foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ugcresearch_user_id_fkey"
		}),
		ugcresearchIdKey: unique("ugcresearch_id_key").on(table.id),
	}
});