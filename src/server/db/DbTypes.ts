import { InferSelectModel } from "drizzle-orm";
import { artists, artistClaims, artistVaultSources, featured, ugcresearch, urlmap, users, mcpApiKeys, mcpAuditLog, artistIdMappings, artistMappingExclusions } from "./schema";

export type Artist = InferSelectModel<typeof artists>;
export type ArtistClaim = InferSelectModel<typeof artistClaims>;
export type ArtistVaultSource = InferSelectModel<typeof artistVaultSources>;
export type Featured = InferSelectModel<typeof featured>;
export type UgcResearch = InferSelectModel<typeof ugcresearch>;
export type UrlMap = InferSelectModel<typeof urlmap>;
export type User = InferSelectModel<typeof users>;
export type McpApiKey = InferSelectModel<typeof mcpApiKeys>;
export type McpAuditLog = InferSelectModel<typeof mcpAuditLog>;
export type ArtistIdMapping = InferSelectModel<typeof artistIdMappings>;
export type ArtistMappingExclusion = InferSelectModel<typeof artistMappingExclusions>;
