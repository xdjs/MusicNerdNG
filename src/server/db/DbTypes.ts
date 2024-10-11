import { InferSelectModel } from "drizzle-orm";
import {users, artists, featured, ugcresearch, ugcwhitelist, } from '@/server/db/schema'

export type User = InferSelectModel<typeof users>;
export type Artist = InferSelectModel<typeof artists>;
export type Featured = InferSelectModel<typeof featured>;
export type UgcResearch = InferSelectModel<typeof ugcresearch>;
export type UgcWhitelist = InferSelectModel<typeof ugcwhitelist>;
