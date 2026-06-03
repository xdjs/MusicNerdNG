import { pgTable, pgPolicy, bigint, text, boolean, uuid, timestamp, jsonb, numeric, index, uniqueIndex, foreignKey, integer, pgEnum, unique } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"

export const platformType = pgEnum("platform_type", ['social', 'web3', 'listen'])
export const claimStatus = pgEnum("claim_status", ['pending', 'approved', 'rejected'])
export const sourceStatus = pgEnum("source_status", ['pending', 'approved', 'rejected'])


export const funfacts = pgTable("funfacts", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).generatedByDefaultAsIdentity({ name: "funfacts_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	loreDrop: text("lore_drop"),
	behindTheScenes: text("behind_the_scenes"),
	recentActivity: text("recent_activity"),
	surpriseMe: text("surprise_me").notNull(),
	isActive: boolean("is_active").default(false),
}, (table) => [
	pgPolicy("Enable read access for all users", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
]);

export const aiprompts = pgTable("aiprompts", {
	promptId: uuid("prompt_id").defaultRandom().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }),
	promptBeforeName: text("prompt_before_name"),
	isActive: boolean("is_active").default(false).notNull(),
	promptAfterName: text("prompt_after_name"),
}, (table) => [
	pgPolicy("mnweb_delete_aiprompts", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_aiprompts", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_aiprompts", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_aiprompts", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const history = pgTable("history", {
	guildId: text("guild_id").notNull(),
	userId: text("user_id").notNull(),
	postedAt: timestamp("posted_at", { withTimezone: true, mode: 'string' }).notNull(),
	topArtist: text("top_artist"),
	topTrack: text("top_track"),
	trackId: text("track_id"),
}, (table) => [
	pgPolicy("mn_bot_history_ins", { as: "permissive", for: "insert", to: ["mn_bot"], withCheck: sql`true`  }),
	pgPolicy("mn_bot_history_sel", { as: "permissive", for: "select", to: ["mn_bot"] }),
	pgPolicy("mn_bot_history_upd", { as: "permissive", for: "update", to: ["mn_bot"] }),
]);

export const botPrompts = pgTable("bot_prompts", {
	slow: jsonb().notNull(),
	moderate: jsonb(),
	busy: jsonb(),
	prompts: text().notNull(),
	funFact: text("fun_fact"),
	shaming: jsonb(),
	trackFact: text("track_fact"),
	emoji: jsonb(),
}, (table) => [
	pgPolicy("mn_bot_bot_prompts_sel", { as: "permissive", for: "select", to: ["mn_bot"], using: sql`true` }),
]);

export const wrapGuilds = pgTable("wrap_guilds", {
	guildId: text("guild_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	localTime: text("local_time"),
	posted: boolean(),
	wrapUp: jsonb("wrap_up"),
	shame: jsonb(),
	wrapTracks: jsonb("wrap_tracks"),
	wrapArtists: jsonb("wrap_artists"),
	interval: numeric(),
	channel: text(),
}, (table) => [
	pgPolicy("mn_bot_wrap_guilds_del", { as: "permissive", for: "delete", to: ["mn_bot"], using: sql`true` }),
	pgPolicy("mn_bot_wrap_guilds_ins", { as: "permissive", for: "insert", to: ["mn_bot"] }),
	pgPolicy("mn_bot_wrap_guilds_sel", { as: "permissive", for: "select", to: ["mn_bot"] }),
	pgPolicy("mn_bot_wrap_guilds_upd", { as: "permissive", for: "update", to: ["mn_bot"] }),
]);

export const userTracks = pgTable("user_tracks", {
	guildId: text("guild_id").notNull(),
	userId: text("user_id").notNull(),
	username: text(),
	tracks: jsonb().default([]),
	topTrack: text("top_track"),
	topArtist: text("top_artist"),
	lastUpdated: timestamp("last_updated", { withTimezone: true, mode: 'string' }),
	artists: jsonb().default([]).notNull(),
}, (table) => [
	index("idx_user_tracks_guild_id").using("btree", table.guildId.asc().nullsLast().op("text_ops")),
	index("idx_user_tracks_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	pgPolicy("mn_bot_user_tracks_ins", { as: "permissive", for: "insert", to: ["mn_bot"], withCheck: sql`true`  }),
	pgPolicy("mn_bot_user_tracks_sel", { as: "permissive", for: "select", to: ["mn_bot"] }),
	pgPolicy("mn_bot_user_tracks_upd", { as: "permissive", for: "update", to: ["mn_bot"] }),
]);

export const users = pgTable("users", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	email: text(),
	username: text(),
	wallet: text(),  // Nullable for Privy users who haven't linked a wallet
	privyUserId: text("privy_user_id"),  // Privy authentication identifier
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	legacyId: text("legacy_id"),
	isAdmin: boolean("is_admin").default(false).notNull(),
	isWhiteListed: boolean("is_white_listed").default(false).notNull(),
	isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
	isHidden: boolean("is_hidden").default(false).notNull(),
	legacyLinkDismissed: boolean("legacy_link_dismissed").default(false).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	acceptedUgcCount: bigint("accepted_ugc_count", { mode: "number" }),
}, (table) => [
	unique("users_wallet_key").on(table.wallet),
	unique("users_privy_user_id_key").on(table.privyUserId),
	pgPolicy("mnweb_delete_users", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_users", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_users", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_users", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const artists = pgTable("artists", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	legacyId: text("legacy_id"),
	bandcamp: text(),
	facebook: text(),
	x: text(),
	soundcloud: text(),
	notes: text(),
	patreon: text(),
	name: text(),
	instagram: text(),
	youtube: text(),
	youtubechannel: text(),
	lcname: text(),
	soundcloudId: integer("soundcloudID"),
	spotify: text(),
	twitch: text(),
	imdb: text(),
	musicbrainz: text(),
	wikidata: text(),
	mixcloud: text(),
	facebookId: text("facebookID"),
	discogs: text(),
	tiktok: text(),
	tiktokId: text("tiktokID"),
	jaxsta: text(),
	famousbirthdays: text(),
	songexploder: text(),
	colorsxstudios: text(),
	bandsintown: text(),
	linktree: text(),
	onlyfans: text(),
	wikipedia: text(),
	audius: text(),
	zora: text(),
	catalog: text(),
	opensea: text(),
	foundation: text(),
	lastfm: text(),
	linkedin: text(),
	soundxyz: text(),
	mirror: text(),
	glassnode: text(),
	collectsNfTs: boolean("collectsNFTs"),
	spotifyusername: text(),
	bandcampfan: text(),
	tellie: text(),
	wallets: text().array(),
	ens: text(),
	lens: text(),
	addedBy: uuid("added_by"),
	cameo: text(),
	farcaster: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	supercollector: text(),
	bio: text(),
	customImage: text("custom_image"),
	webmapdata: jsonb(),
	nodePfp: jsonb("node_pfp"),
	deezer: text(),
}, (table) => [
	index("artists_added_by_created_at_idx").using("btree", table.addedBy.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("artists_lcname_btree_idx").using("btree", table.lcname.asc().nullsLast().op("text_ops")),
	index("artists_lcname_trgm_gin").using("gin", table.lcname.asc().nullsLast().op("gin_trgm_ops")),
	index("artists_lcname_trgm_idx").using("gist", table.lcname.asc().nullsLast().op("gist_trgm_ops")),
	index("artists_name_trgm_idx").using("gist", table.name.asc().nullsLast().op("gist_trgm_ops")),
	uniqueIndex("artists_spotify_uniq").using("btree", table.spotify.asc().nullsLast().op("text_ops")).where(sql`(spotify IS NOT NULL)`),
	uniqueIndex("artists_deezer_uniq").using("btree", table.deezer.asc().nullsLast().op("text_ops")).where(sql`(deezer IS NOT NULL)`),
	index("idx_artists_added_by").using("btree", table.addedBy.asc().nullsLast().op("uuid_ops")),
	index("idx_artists_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("idx_artists_name_gin").using("gin", sql`to_tsvector('english'::regconfig, name)`),
	index("idx_artists_created_at").using("btree", table.createdAt.desc().nullsLast()),
	foreignKey({
			columns: [table.addedBy],
			foreignColumns: [users.id],
			name: "artists_added_by_fkey"
		}),
	pgPolicy("Allow webmapdata_editor to see all rows", { as: "permissive", for: "select", to: ["webmapdata_editor"], using: sql`true` }),
	pgPolicy("Allow webmapdata_editor to update webmapdata column", { as: "permissive", for: "update", to: ["webmapdata_editor"] }),
	pgPolicy("mnweb_delete_artists", { as: "permissive", for: "delete", to: ["mnweb"] }),
	pgPolicy("mnweb_insert_artists", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_artists", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_artists", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const ugcresearch = pgTable("ugcresearch", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	artistUri: text("artist_uri"),
	accepted: boolean().default(false),
	ugcUrl: text("ugc_url"),
	siteName: text("site_name"),
	siteUsername: text("site_username"),
	artistId: uuid("artist_id"),
	dateProcessed: timestamp("date_processed", { mode: 'string' }),
	name: text(),
	userId: uuid("user_id"),
}, (table) => [
	index("idx_ugcresearch_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("ugcresearch_user_created_at_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_ugcresearch_date_processed").using("btree", table.dateProcessed.desc().nullsLast()),
	foreignKey({
			columns: [table.artistId],
			foreignColumns: [artists.id],
			name: "ugcresearch_artist_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ugcresearch_user_id_fkey"
		}),
	pgPolicy("mnweb_delete_ugcresearch", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_ugcresearch", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_ugcresearch", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_ugcresearch", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const featured = pgTable("featured", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	featuredArtist: uuid("featured_artist"),
	featuredCollector: uuid("featured_collector"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.featuredArtist],
			foreignColumns: [artists.id],
			name: "featured_featured_artist_fkey"
		}),
	foreignKey({
			columns: [table.featuredCollector],
			foreignColumns: [artists.id],
			name: "featured_featured_collector_fkey"
		}),
	pgPolicy("mnweb_delete_featured", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_featured", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_featured", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_featured", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const urlmap = pgTable("urlmap", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	siteUrl: text("site_url").notNull(),
	siteName: text("site_name").notNull(),
	example: text().notNull(),
	appStringFormat: text("app_string_format").notNull(),
	order: integer(),
	isIframeEnabled: boolean("is_iframe_enabled").default(false).notNull(),
	isEmbedEnabled: boolean("is_embed_enabled").default(false).notNull(),
	cardDescription: text("card_description"),
	cardPlatformName: text("card_platform_name"),
	isWeb3Site: boolean("is_web3_site").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`),
	siteImage: text("site_image"),
	regex: text().default('""').notNull(),
	regexMatcher: text("regex_matcher"),
	isMonetized: boolean("is_monetized").default(false).notNull(),
	regexOptions: text("regex_options").array(),
	colorHex: text("color_hex").default('#000000'),
	platformTypeList: platformType("platform_type_list").array().default(["social"]),
}, (table) => [
	unique("urlmap_siteurl_key").on(table.siteUrl),
	unique("urlmap_sitename_key").on(table.siteName),
	unique("urlmap_example_key").on(table.example),
	unique("urlmap_appstringformat_key").on(table.appStringFormat),
	pgPolicy("mnweb_delete_urlmap", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_urlmap", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_urlmap", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_urlmap", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const mcpApiKeys = pgTable("mcp_api_keys", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	keyHash: text("key_hash").notNull().unique(),
	label: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	pgPolicy("mnweb_select_mcp_api_keys", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_mcp_api_keys", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
	pgPolicy("mnweb_update_mcp_api_keys", { as: "permissive", for: "update", to: ["mnweb"], using: sql`true` }),
	// No DELETE policy for mnweb — keys are soft-deleted via revoked_at UPDATE, not hard-deleted
]);

// Append-only audit log — no UPDATE or DELETE policies granted to application role.
export const mcpAuditLog = pgTable("mcp_audit_log", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	artistId: uuid("artist_id").notNull(),
	field: text().notNull(),
	action: text().notNull(),
	submittedUrl: text("submitted_url"),
	oldValue: text("old_value"),
	newValue: text("new_value"),
	apiKeyHash: text("api_key_hash").notNull(), // Intentionally not a FK — audit records survive key deletion
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
}, (table) => [
	foreignKey({
		columns: [table.artistId],
		foreignColumns: [artists.id],
		name: "mcp_audit_log_artist_id_fkey"
	}),
	index("idx_mcp_audit_log_artist_id").using("btree", table.artistId.asc().nullsLast().op("uuid_ops")),
	index("idx_mcp_audit_log_created_at").using("btree", table.createdAt.desc().nullsLast()),
	index("idx_mcp_audit_log_api_key_hash_created_at").using("btree", table.apiKeyHash.asc().nullsLast(), table.createdAt.desc().nullsLast()),
	pgPolicy("mnweb_select_mcp_audit_log", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_mcp_audit_log", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
]);

export const artistClaims = pgTable("artist_claims", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	artistId: uuid("artist_id").notNull(),
	status: claimStatus().default('pending').notNull(),
	referenceCode: text("reference_code"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
}, (table) => [
	unique("artist_claims_artist_id_key").on(table.artistId),
	index("idx_artist_claims_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("idx_artist_claims_artist_id").using("btree", table.artistId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "artist_claims_user_id_fkey"
	}),
	foreignKey({
		columns: [table.artistId],
		foreignColumns: [artists.id],
		name: "artist_claims_artist_id_fkey"
	}),
	pgPolicy("mnweb_delete_artist_claims", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_artist_claims", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_artist_claims", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_artist_claims", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const artistVaultSources = pgTable("artist_vault_sources", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	artistId: uuid("artist_id").notNull(),
	url: text().notNull(),
	title: text(),
	snippet: text(),
	type: text(),
	status: sourceStatus().default('pending').notNull(),
	fileName: text("file_name"),
	fileSize: integer("file_size"),
	filePath: text("file_path"),
	contentType: text("content_type"),
	extractedText: text("extracted_text"),
	ogImage: text("og_image"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
}, (table) => [
	index("idx_artist_vault_sources_artist_id").using("btree", table.artistId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.artistId],
		foreignColumns: [artists.id],
		name: "artist_vault_sources_artist_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("mnweb_delete_artist_vault_sources", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_artist_vault_sources", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_select_artist_vault_sources", { as: "permissive", for: "select", to: ["mnweb"] }),
	pgPolicy("mnweb_update_artist_vault_sources", { as: "permissive", for: "update", to: ["mnweb"] }),
]);

export const artistBioVersions = pgTable("artist_bio_versions", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	artistId: uuid("artist_id").notNull(),
	bioText: text("bio_text").notNull(),
	isPinned: boolean("is_pinned").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`(now() AT TIME ZONE 'utc'::text)`).notNull(),
}, (table) => [
	index("idx_artist_bio_versions_artist_id").using("btree", table.artistId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.artistId],
		foreignColumns: [artists.id],
		name: "artist_bio_versions_artist_id_fkey"
	}).onDelete("cascade"),
	pgPolicy("mnweb_select_artist_bio_versions", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_artist_bio_versions", { as: "permissive", for: "insert", to: ["mnweb"] }),
	pgPolicy("mnweb_update_artist_bio_versions", { as: "permissive", for: "update", to: ["mnweb"] }),
	pgPolicy("mnweb_delete_artist_bio_versions", { as: "permissive", for: "delete", to: ["mnweb"], using: sql`true` }),
]);

export const exclusionReason = pgEnum("exclusion_reason", [
  "conflict",       // platform ID already mapped to different artist
  "name_mismatch",  // Deezer name doesn't match MusicNerd name
  "too_ambiguous",  // name too generic, can't confidently match
]);

export const confidenceLevel = pgEnum("confidence_level", ["high", "medium", "low", "manual"]);

export const artistIdMappings = pgTable("artist_id_mappings", {
  id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
  artistId: uuid("artist_id").notNull(),
  platform: text().notNull(),
  platformId: text("platform_id").notNull(),
  confidence: confidenceLevel().notNull(),
  source: text().notNull(),
  reasoning: text(),
  apiKeyHash: text("api_key_hash"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
}, (table) => [
  unique("artist_id_mappings_artist_platform_uniq").on(table.artistId, table.platform),
  unique("artist_id_mappings_platform_id_uniq").on(table.platform, table.platformId),
  foreignKey({ columns: [table.artistId], foreignColumns: [artists.id], name: "artist_id_mappings_artist_id_fkey" }),
  index("idx_artist_id_mappings_platform_artist").using("btree", table.platform.asc().nullsLast(), table.artistId.asc().nullsLast()),
  index("idx_artist_id_mappings_confidence").using("btree", table.confidence.asc().nullsLast()),
  pgPolicy("mnweb_select_artist_id_mappings", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
  pgPolicy("mnweb_insert_artist_id_mappings", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
  pgPolicy("mnweb_update_artist_id_mappings", { as: "permissive", for: "update", to: ["mnweb"], using: sql`true` }),
]);

export const artistMappingExclusions = pgTable("artist_mapping_exclusions", {
  id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
  artistId: uuid("artist_id").notNull(),
  platform: text().notNull(),
  reason: exclusionReason().notNull(),
  details: text(),
  apiKeyHash: text("api_key_hash"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
}, (table) => [
  unique("artist_mapping_exclusions_artist_platform_uniq").on(table.artistId, table.platform),
  foreignKey({ columns: [table.artistId], foreignColumns: [artists.id], name: "artist_mapping_exclusions_artist_id_fkey" }).onDelete("cascade"),
  index("idx_artist_mapping_exclusions_platform").using("btree", table.platform.asc().nullsLast()),
  pgPolicy("mnweb_select_artist_mapping_exclusions", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
  pgPolicy("mnweb_insert_artist_mapping_exclusions", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
  pgPolicy("mnweb_update_artist_mapping_exclusions", { as: "permissive", for: "update", to: ["mnweb"], using: sql`true` }),
  // No DELETE policy for mnweb — exclusions are cleared via direct DB access, not the app role
]);

export const agentHeartbeats = pgTable("agent_heartbeats", {
	id: uuid().default(sql`gen_random_uuid()`).primaryKey().notNull(),
	workerId: text("worker_id").notNull().unique(),
	apiKeyHash: text("api_key_hash").notNull(),
	status: text().notNull().default('starting'),
	currentRun: integer("current_run"),
	batchPlatform: text("batch_platform"),
	batchSize: integer("batch_size"),
	message: text(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
	config: jsonb(),
}, (table) => [
	index("idx_agent_heartbeats_updated_at").using("btree", table.updatedAt.desc().nullsLast()),
	pgPolicy("mnweb_select_agent_heartbeats", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_agent_heartbeats", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
	pgPolicy("mnweb_update_agent_heartbeats", { as: "permissive", for: "update", to: ["mnweb"], using: sql`true` }),
]);

export const agentRuns = pgTable("agent_runs", {
	id: uuid().default(sql`gen_random_uuid()`).primaryKey().notNull(),
	workerId: text("worker_id").notNull(),
	apiKeyHash: text("api_key_hash").notNull(),
	runNumber: integer("run_number").notNull(),
	platform: text().notNull().default('deezer'),
	status: text().notNull().default('running'),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	wallTimeSecs: integer("wall_time_secs"),
	claudeTimeSecs: integer("claude_time_secs"),
	apiTimeSecs: integer("api_time_secs"),
	turns: integer(),
	batchSize: integer("batch_size"),
	resolved: integer().default(0),
	excluded: integer().default(0),
	skipped: integer().default(0),
	errors: integer().default(0),
	highConfidence: integer("high_confidence").default(0),
	mediumConfidence: integer("medium_confidence").default(0),
	conflicts: integer().default(0),
	nameMismatches: integer("name_mismatches").default(0),
	tooAmbiguous: integer("too_ambiguous").default(0),
	exitCode: integer("exit_code"),
	failCategory: text("fail_category"),
	failReason: text("fail_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`).notNull(),
}, (table) => [
	uniqueIndex("idx_agent_runs_worker_run").using("btree", table.workerId.asc().nullsLast(), table.runNumber.asc().nullsLast()),
	index("idx_agent_runs_started_at").using("btree", table.startedAt.desc().nullsLast()),
	pgPolicy("mnweb_select_agent_runs", { as: "permissive", for: "select", to: ["mnweb"], using: sql`true` }),
	pgPolicy("mnweb_insert_agent_runs", { as: "permissive", for: "insert", to: ["mnweb"], withCheck: sql`true` }),
	pgPolicy("mnweb_update_agent_runs", { as: "permissive", for: "update", to: ["mnweb"], using: sql`true` }),
])

// Relations
export const artistsRelations = relations(artists, ({one, many}) => ({
	user: one(users, {
		fields: [artists.addedBy],
		references: [users.id]
	}),
	idMappings: many(artistIdMappings),
	mappingExclusions: many(artistMappingExclusions),
	ugcresearches: many(ugcresearch),
	featureds_featuredArtist: many(featured, {
		relationName: "featured_featuredArtist_artists_id"
	}),
	featureds_featuredCollector: many(featured, {
		relationName: "featured_featuredCollector_artists_id"
	}),
	artistClaims: many(artistClaims),
	artistVaultSources: many(artistVaultSources),
	artistBioVersions: many(artistBioVersions),
}));

export const artistBioVersionsRelations = relations(artistBioVersions, ({one}) => ({
	artist: one(artists, {
		fields: [artistBioVersions.artistId],
		references: [artists.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	artists: many(artists),
	ugcresearches: many(ugcresearch),
	artistClaims: many(artistClaims),
}));

export const ugcresearchRelations = relations(ugcresearch, ({one}) => ({
	artist: one(artists, {
		fields: [ugcresearch.artistId],
		references: [artists.id]
	}),
	user: one(users, {
		fields: [ugcresearch.userId],
		references: [users.id]
	}),
}));

export const featuredRelations = relations(featured, ({one}) => ({
	artist_featuredArtist: one(artists, {
		fields: [featured.featuredArtist],
		references: [artists.id],
		relationName: "featured_featuredArtist_artists_id"
	}),
	artist_featuredCollector: one(artists, {
		fields: [featured.featuredCollector],
		references: [artists.id],
		relationName: "featured_featuredCollector_artists_id"
	}),
}));

export const artistClaimsRelations = relations(artistClaims, ({one}) => ({
	user: one(users, {
		fields: [artistClaims.userId],
		references: [users.id]
	}),
	artist: one(artists, {
		fields: [artistClaims.artistId],
		references: [artists.id]
	}),
}));

export const artistVaultSourcesRelations = relations(artistVaultSources, ({one}) => ({
	artist: one(artists, {
		fields: [artistVaultSources.artistId],
		references: [artists.id]
	}),
}));

export const artistIdMappingsRelations = relations(artistIdMappings, ({one}) => ({
	artist: one(artists, {
		fields: [artistIdMappings.artistId],
		references: [artists.id],
	}),
}));

export const artistMappingExclusionsRelations = relations(artistMappingExclusions, ({one}) => ({
	artist: one(artists, {
		fields: [artistMappingExclusions.artistId],
		references: [artists.id],
	}),
}));
