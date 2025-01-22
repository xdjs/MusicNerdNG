import { getServerAuthSession } from "@/server/auth";
import Dashboard from "./Dashboard";
import { notFound } from "next/navigation";
import Login from "./Login";
import { getUserById } from "@/server/utils/queriesTS";

export default async function Page() {
    const session = await getServerAuthSession();
    if (!session) {
        return (
            <section className="px-10 py-5 space-y-6 flex flex-col items-center justify-center">
                <p>Login to view UGC Stats</p>
                <Login />
            </section>
        )
    }
    const user = await getUserById(session.user.id);
    if (!user) {
        return notFound();
    }
    return <Dashboard user={user} />;
}
