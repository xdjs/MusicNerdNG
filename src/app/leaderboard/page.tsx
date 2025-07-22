import { getServerAuthSession } from "@/server/auth";
import Dashboard from "@/app/profile/Dashboard";
import Leaderboard from "@/app/profile/Leaderboard";
import LeaderboardAutoRefresh from "./LeaderboardAutoRefresh";
import Login from "@/app/_components/nav/components/Login";
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
    return (
        <main className="px-5 sm:px-10 py-10">
            <LeaderboardAutoRefresh />
            <Leaderboard />
        </main>
    ); // show leaderboard only for guest
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
    return (
        <main className="px-5 sm:px-10 py-10 flex flex-col items-center gap-6">
            <LeaderboardAutoRefresh />
            <Leaderboard />
            <div className="mt-4">
                <Login
                    buttonChildren={<span className="font-semibold whitespace-nowrap">View&nbsp;My&nbsp;Stats</span>}
                    buttonStyles="w-auto h-auto px-4 py-2 bg-pastypink text-white hover:bg-pastypink/90 rounded-md"
                />
            </div>
        </main>
    ); // leaderboard for guest
  }

  const user = await getUserById(session.user.id);
  if (!user) return notFound();
  return <Dashboard user={user} allowEditUsername={false} showDateRange={false} hideLogin={true} showStatus={false} />;
} 