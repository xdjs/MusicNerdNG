import type { Session } from "@/server/auth";
import { db } from "@/server/db/drizzle";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Returns a mock session for dev mode when no real session exists.
 * Only active when NODE_ENV === 'development'.
 */
export async function getDevSession(): Promise<Session | null> {
    if (process.env.NODE_ENV !== "development") return null;

    try {
        // Try to find existing dev user
        let devUser = await db.query.users.findFirst({
            where: eq(users.email, "dev@localhost"),
        });

        // Create dev user if not found
        if (!devUser) {
            const [created] = await db
                .insert(users)
                .values({
                    email: "dev@localhost",
                    username: "DevUser",
                    isAdmin: true,
                    isWhiteListed: true,
                })
                .returning();
            devUser = created;
        }

        if (!devUser) return null;

        return {
            user: {
                id: devUser.id,
                email: devUser.email,
                name: devUser.username,
                isAdmin: devUser.isAdmin,
                isWhiteListed: devUser.isWhiteListed,
                isSuperAdmin: devUser.isSuperAdmin,
                isHidden: devUser.isHidden,
            },
            expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
    } catch (error) {
        console.error("[dev-auth] Error creating dev session:", error);
        return null;
    }
}
