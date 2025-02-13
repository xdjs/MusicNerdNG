import { getServerAuthSession } from "@/server/auth";
import Dashboard from "./Dashboard";
import { notFound } from "next/navigation";
import { getUserById } from "@/server/utils/queriesTS";
import Login from "../_components/nav/components/Login";
import PleaseLoginPage from "../_components/PleaseLoginPage";

export default async function Page() {
    const session = await getServerAuthSession();
    if (!session) return <PleaseLoginPage text="Login to view UGC Stats" />;
    const user = await getUserById(session.user.id);
    if (!user) return notFound();
    return <Dashboard user={user} />;
}
