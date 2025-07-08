import { db } from "@/server/db/drizzle";
import { eq, ilike, inArray } from "drizzle-orm";
import { users } from "@/server/db/schema";
import { getServerAuthSession } from "@/server/auth";

export async function getUserByWallet(wallet: string) {
    try {
        const result = await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
        return result;
    } catch (error) {
        console.error("error getting user by wallet", error);
        if (error instanceof Error) {
            throw new Error(`Error finding user: ${error.message}`);
        }
        throw new Error("Error finding user: Unknown error");
    }
}

export async function getUserById(id: string) {
    try {
        const result = await db.query.users.findFirst({ where: eq(users.id, id) });
        return result;
    } catch (error) {
        console.error("error getting user by Id", error);
        if (error instanceof Error) {
            throw new Error(`Error finding user: ${error.message}`);
        }
        throw new Error("Error finding user: Unknown error");
    }
}

export async function createUser(wallet: string) {
    try {
        const [newUser] = await db.insert(users).values({ wallet }).returning();
        return newUser;
    } catch (e) {
        console.error("error creating user", e);
        throw new Error("Error creating user");
    }
}

export async function getWhitelistedUsers() {
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === "true" && process.env.NODE_ENV !== "production";
    const session = await getServerAuthSession();
    if (!session && !walletlessEnabled) throw new Error("Unauthorized");
    try {
        const result = await db.query.users.findMany({ where: eq(users.isWhiteListed, true) });
        return result ?? [];
    } catch (e) {
        console.error("error getting whitelisted users", e);
        throw new Error("Error getting whitelisted users");
    }
}

export async function removeFromWhitelist(userIds: string[]) {
    try {
        await db.update(users).set({ isWhiteListed: false }).where(inArray(users.id, userIds));
    } catch (e) {
        console.error("error removing from whitelist", e);
    }
}

export type AddUsersToWhitelistResp = {
    status: "success" | "error";
    message: string;
};

export async function addUsersToWhitelist(walletAddresses: string[]): Promise<AddUsersToWhitelistResp> {
    try {
        await db.update(users).set({ isWhiteListed: true }).where(inArray(users.wallet, walletAddresses));
        return { status: "success", message: "Users added to whitelist" };
    } catch (e) {
        console.error("error adding users to whitelist", e);
        return { status: "error", message: "Error adding users to whitelist" };
    }
}

export async function searchForUsersByWallet(wallet: string) {
    try {
        const result = await db.query.users.findMany({ where: ilike(users.wallet, `%${wallet}%`) });
        return result.map((user) => user.wallet);
    } catch (e) {
        console.error("searching for users by wallet", e);
    }
}

export type UpdateWhitelistedUserResp = {
    status: "success" | "error";
    message: string;
};

// Updates a whitelisted user's editable fields (wallet, email, username)
export async function updateWhitelistedUser(
    userId: string,
    data: { wallet?: string; email?: string; username?: string }
): Promise<UpdateWhitelistedUserResp> {
    try {
        if (!userId) throw new Error("Invalid user id");
        const updateData: Record<string, string> = {};
        if (data.wallet !== undefined) updateData.wallet = data.wallet;
        if (data.email !== undefined) updateData.email = data.email;
        if (data.username !== undefined) updateData.username = data.username;

        if (Object.keys(updateData).length === 0) {
            return { status: "error", message: "No fields to update" };
        }

        await db.update(users).set(updateData).where(eq(users.id, userId));
        return { status: "success", message: "Whitelist user updated" };
    } catch (e) {
        console.error("error updating whitelisted user", e);
        return { status: "error", message: "Error updating whitelisted user" };
    }
} 