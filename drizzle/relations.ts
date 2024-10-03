import { relations } from "drizzle-orm/relations";
import { users, artists, ugcresearch, ugcwhitelist } from "./schema";

export const artistsRelations = relations(artists, ({one, many}) => ({
	user: one(users, {
		fields: [artists.addedBy],
		references: [users.id]
	}),
	ugcresearches: many(ugcresearch),
}));

export const usersRelations = relations(users, ({many}) => ({
	artists: many(artists),
	ugcresearches: many(ugcresearch),
	ugcwhitelists: many(ugcwhitelist),
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

export const ugcwhitelistRelations = relations(ugcwhitelist, ({one}) => ({
	user: one(users, {
		fields: [ugcwhitelist.userid],
		references: [users.id]
	}),
}));