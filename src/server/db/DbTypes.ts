import { InferSelectModel } from "drizzle-orm";
import { artists, featured, ugcresearch, urlmap, users } from "./schema";

export type Artist = InferSelectModel<typeof artists>;
export type Featured = InferSelectModel<typeof featured>;
export type UgcResearch = InferSelectModel<typeof ugcresearch>;
export type UrlMap = InferSelectModel<typeof urlmap>;
export type User = InferSelectModel<typeof users>;