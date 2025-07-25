import { pgTable, foreignKey, uuid, timestamp, unique, text, integer, boolean, pgEnum, serial, varchar, jsonb, decimal } from "drizzle-orm/pg-core"
import { is, relations, sql } from "drizzle-orm"
export const platformType = pgEnum("platform_type", ['social', 'web3', 'listen'])


export const ugcwhitelist = pgTable("ugcwhitelist", {
	userId: uuid("user_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
	(table) => {
		return {
			ugcwhitelistUseridFkey: foreignKey({
				columns: [table.userId],
				foreignColumns: [users.id],
				name: "ugcwhitelist_userid_fkey"
			}),
		}
	});

export const urlmap = pgTable("urlmap", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	siteUrl: text("site_url").notNull(),
	siteName: text("site_name").notNull(),
	example: text("example").notNull(),
	appStringFormat: text("app_string_format").notNull(),
	order: integer("order"),
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
	regexOptions: text("regex_options").array(),
	platformTypeList: platformType("platform_type_list").array().default(["social"]),
	colorHex: text("color_hex").notNull(),
},
	(table) => {
		return {
			urlmapSiteurlKey: unique("urlmap_siteurl_key").on(table.siteUrl),
			urlmapSitenameKey: unique("urlmap_sitename_key").on(table.siteName),
			urlmapExampleKey: unique("urlmap_example_key").on(table.example),
			urlmapAppstingformatKey: unique("urlmap_appstingformat_key").on(table.appStringFormat),
		}
	});

export const featured = pgTable("featured", {
	id: uuid("id").default(sql`uuid_generate_v4()`),
	featuredArtist: uuid("featured_artist"),
	featuredCollector: uuid("featured_collector"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
},
	(table) => {
		return {
			featuredFeaturedartistFkey: foreignKey({
				columns: [table.featuredArtist],
				foreignColumns: [artists.id],
				name: "featured_featuredartist_fkey"
			}),
			featuredFeaturedcollectorFkey: foreignKey({
				columns: [table.featuredCollector],
				foreignColumns: [artists.id],
				name: "featured_featuredcollector_fkey"
			}),
		}
	});

export const featuredRelations = relations(featured, ({ one }) => ({
	featuredArtist: one(artists, { fields: [featured.featuredArtist], references: [artists.id], relationName: "featuredArtistObject" }),
	featuredCollector: one(artists, { fields: [featured.featuredCollector], references: [artists.id], relationName: "featuredcollector" }),
}));

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
	x: text("x"),
	soundcloud: text("soundcloud"),
	notes: text("notes"),
	patreon: text("patreon"),
	name: text("name"),
	instagram: text("instagram"),
	youtube: text("youtube"),
	youtubechannel: text("youtubechannel"),
	bio: text("bio"),
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
	addedBy: uuid("added_by").notNull().default(sql`uuid_generate_v4()`),
	cameo: text("cameo"),
	farcaster: text("farcaster"),
	supercollector: text("supercollector"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
},
	(table) => {
		return {
			artistsAddedbyFkey: foreignKey({
				columns: [table.addedBy],
				foreignColumns: [users.id],
				name: "artists_addedby_fkey"
			}),
		}
	});

export const ugcresearch = pgTable("ugcresearch", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	artistUri: text("artist_uri"),
	accepted: boolean("accepted"),
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
				name: "ugcresearch_artistID_fkey"
			}),
			ugcresearchUserIdFkey: foreignKey({
				columns: [table.userId],
				foreignColumns: [users.id],
				name: "ugcresearch_userID_fkey"
			}).onDelete("set null"),
		}
	});

export const ugcRelations = relations(ugcresearch, ({ one }) => ({
	ugcArtist: one(artists, { fields: [ugcresearch.artistId], references: [artists.id], relationName: "ugcArtistObject" }),
	ugcUser: one(users, { fields: [ugcresearch.userId], references: [users.id], relationName: "ugcUser" }),
}));

export const coverageReports = pgTable('coverage_reports', {
	id: serial('id').primaryKey(),
	repository: varchar('repository', { length: 255 }).notNull(),
	branch: varchar('branch', { length: 255 }).notNull(),
	commit_sha: varchar('commit_sha', { length: 40 }).notNull(),
	workflow_run_id: varchar('workflow_run_id', { length: 50 }),
	coverage_data: jsonb('coverage_data').notNull(),
	total_coverage: decimal('total_coverage', { precision: 5, scale: 2 }),
	lines_covered: integer('lines_covered'),
	lines_total: integer('lines_total'),
	functions_covered: integer('functions_covered'),
	functions_total: integer('functions_total'),
	branches_covered: integer('branches_covered'),
	branches_total: integer('branches_total'),
	statements_covered: integer('statements_covered'),
	statements_total: integer('statements_total'),
	created_at: timestamp('created_at').defaultNow().notNull(),
	updated_at: timestamp('updated_at').defaultNow().notNull()
});

export const aiPrompts = pgTable("aiprompts", {
	id: uuid("prompt_id").primaryKey().defaultRandom(),
	createdAt: timestamp("created_at").defaultNow(), 	
	promptBeforeName: text("prompt_before_name").notNull(),
	promptAfterName: text("prompt_after_name").notNull(),
	isActive: boolean("is_active").default(false),
  });

export const funFacts = pgTable("funfacts", {
	id: integer("id").primaryKey().notNull(), 
	loreDrop: text("lore_drop").notNull(),
     behindTheScenes: text("behind_the_scenes").notNull(),
     recentActivity: text("recent_activity").notNull(),
     surpriseMe: text("surprise_me").notNull(),  
	isActive: boolean("is_active").default(false),
});
