import { getServerAuthSession } from "@/server/auth";
import Dashboard from "./Dashboard";
import { notFound } from "next/navigation";
import { getUserById } from "@/server/utils/queriesTS";
import Login from "../_components/nav/components/Login";
import PleaseLoginPage from "../_components/PleaseLoginPage";

export default async function Page() {
    const session = await getServerAuthSession();
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';
    
    // If wallet requirement is disabled, allow access without authentication
    if (walletlessEnabled) {
        // Create a mock user object for the dashboard
        const mockUser = {
            id: '00000000-0000-0000-0000-000000000000',
            wallet: '0x0000000000000000000000000000000000000000',
            email: null,
            username: 'Guest User',
            isAdmin: false,
            isWhiteListed: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            legacyId: null
        } as const;
        return <Dashboard user={mockUser} />;
    }
    
    // Normal authentication flow
    if (!session) return <PleaseLoginPage text="Login to view UGC Stats" />;
    const user = await getUserById(session.user.id);
    if (!user) return notFound();
    return <Dashboard user={user} />;
}
