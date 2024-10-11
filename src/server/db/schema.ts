import { pgTable, foreignKey, uuid, timestamp, unique, text, integer, boolean } from "drizzle-orm/pg-core"
  import { relations, sql } from "drizzle-orm"




export const ugcwhitelist = pgTable("ugcwhitelist", {
	userid: uuid("userid"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		ugcwhitelistUseridFkey: foreignKey({
			columns: [table.userid],
			foreignColumns: [users.id],
			name: "ugcwhitelist_userid_fkey"
		}),
	}
});

export const urlmap = pgTable("urlmap", {
	id: uuid("id").default(sql`uuid_generate_v4()`),
	siteurl: text("siteurl").notNull(),
	sitename: text("sitename").notNull(),
	example: text("example").notNull(),
	appstingformat: text("appstingformat").notNull(),
	cardorder: integer("cardorder"),
	isiframeenabled: boolean("isiframeenabled").default(false).notNull(),
	isembedenabled: boolean("isembedenabled").default(false).notNull(),
	carddescription: text("carddescription").notNull(),
	cardplatformname: text("cardplatformname").notNull(),
	isweb3Site: boolean("isweb3site").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`),
},
(table) => {
	return {
		urlmapSiteurlKey: unique("urlmap_siteurl_key").on(table.siteurl),
		urlmapSitenameKey: unique("urlmap_sitename_key").on(table.sitename),
		urlmapExampleKey: unique("urlmap_example_key").on(table.example),
		urlmapAppstingformatKey: unique("urlmap_appstingformat_key").on(table.appstingformat),
	}
});

export const featured = pgTable("featured", {
	id: uuid("id").default(sql`uuid_generate_v4()`),
	featuredartist: uuid("featuredartist").references(() => artists.id),
	featuredcollector: uuid("featuredcollector").references(() => artists.id),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
},
(table) => {
	return {
		featuredFeaturedartistFkey: foreignKey({
			columns: [table.featuredartist],
			foreignColumns: [artists.id],
			name: "featured_featuredartist_fkey"
		}),
		featuredFeaturedcollectorFkey: foreignKey({
			columns: [table.featuredcollector],
			foreignColumns: [artists.id],
			name: "featured_featuredcollector_fkey"
		}),
	}
});

export const featuredRelations = relations(featured, ({ one }) => ({
	featuredArtist: one(artists, { fields: [featured.featuredartist], references: [artists.id], relationName: "featuredArtistObject" }),
	featuredCollector: one(artists, { fields: [featured.featuredcollector], references: [artists.id], relationName: "featuredcollector" }),
  }));

export const users = pgTable("users", {
	id: uuid("id").default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	email: text("email"),
	username: text("username"),
	wallet: text("wallet").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	legacyId: text("legacy_id"),
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
	addedBy: uuid("addedBy"),
	cameo: text("cameo"),
	farcaster: text("farcaster"),
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
	id: uuid("id").default(sql`uuid_generate_v4()`),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	artistUri: text("artistURI"),
	accepted: boolean("accepted"),
	ugcUrl: text("ugcURL"),
	siteName: text("siteName"),
	siteUsername: text("siteUsername"),
	artistId: uuid("artistID"),
	dateProcessed: timestamp("dateProcessed", { mode: 'string' }),
	name: text("name"),
	userId: uuid("userID"),
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
		}),
	}
});