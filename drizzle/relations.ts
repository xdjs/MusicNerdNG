import { relations } from "drizzle-orm/relations";
import { users, ugcwhitelist, artists, featured, ugcresearch } from "./schema";

export const ugcwhitelistRelations = relations(ugcwhitelist, ({one}) => ({
	user: one(users, {
		fields: [ugcwhitelist.userid],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	ugcwhitelists: many(ugcwhitelist),
	artists: many(artists),
	ugcresearches: many(ugcresearch),
}));

export const featuredRelations = relations(featured, ({one}) => ({
	artist_featuredartist: one(artists, {
		fields: [featured.featuredartist],
		references: [artists.id],
		relationName: "featured_featuredartist_artists_id"
	}),
	artist_featuredcollector: one(artists, {
		fields: [featured.featuredcollector],
		references: [artists.id],
		relationName: "featured_featuredcollector_artists_id"
	}),
}));

export const artistsRelations = relations(artists, ({one, many}) => ({
	featureds_featuredartist: many(featured, {
		relationName: "featured_featuredartist_artists_id"
	}),
	featureds_featuredcollector: many(featured, {
		relationName: "featured_featuredcollector_artists_id"
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