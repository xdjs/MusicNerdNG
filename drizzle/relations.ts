import { relations } from "drizzle-orm/relations";
import { users, ugcwhitelist, artists, featured, ugcresearch, urlmap, funFacts, aiPrompts, coverageReports } from "../src/server/db/schema";

export const ugcwhitelistRelations = relations(ugcwhitelist, ({one}) => ({
	user: one(users, {
		fields: [ugcwhitelist.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	ugcwhitelists: many(ugcwhitelist),
	artists: many(artists),
	ugcresearches: many(ugcresearch),
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

export const artistsRelations = relations(artists, ({one, many}) => ({
	featureds_featuredArtist: many(featured, {
		relationName: "featured_featuredArtist_artists_id"
	}),
	featureds_featuredCollector: many(featured, {
		relationName: "featured_featuredCollector_artists_id"
	}),
	user: one(users, {
		fields: [artists.addedBy],
		references: [users.id]
	}),
	ugcresearches: many(ugcresearch),
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

// Add missing table relations (required for db.query API)
export const funFactsRelations = relations(funFacts, () => ({}));
export const aiPromptsRelations = relations(aiPrompts, () => ({}));
export const urlmapRelations = relations(urlmap, () => ({}));
export const coverageReportsRelations = relations(coverageReports, () => ({}));