import { getServerAuthSession } from "@/server/auth";
import Dashboard from "@/app/profile/Dashboard";
import { notFound } from "next/navigation";
import { getUserById } from "@/server/utils/queries/userQueries";

export default async function Page() {
  const session = await getServerAuthSession();
  const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

  if (walletlessEnabled) {
    const mockUser = {
      id: '00000000-0000-0000-0000-000000000000',
      wallet: '0x0000000000000000000000000000000000000000',
      email: null,
      username: 'Guest User',
      isAdmin: false,
      isWhiteListed: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      legacyId: null,
    } as const;
    return <Dashboard user={mockUser} allowEditUsername={false} showDateRange={false} hideLogin={true} showStatus={false} />; // no status on leaderboard
  }

  if (!session) {
    const guestUser = {
      id: '00000000-0000-0000-0000-000000000000',
      wallet: '0x0000000000000000000000000000000000000000',
      email: null,
      username: 'Guest User',
      isAdmin: false,
      isWhiteListed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      legacyId: null,
    } as const;
    return <Dashboard user={guestUser} allowEditUsername={false} showDateRange={false} hideLogin={true} showStatus={false} />;
  }

  const user = await getUserById(session.user.id);
  if (!user) return notFound();
  return <Dashboard user={user} allowEditUsername={false} showDateRange={false} hideLogin={true} showStatus={false} />;
} 