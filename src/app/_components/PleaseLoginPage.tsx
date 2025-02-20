"use client"

import { Button } from "@/components/ui/button";

export default function PleaseLoginPage({text = "Login to access this page"}: {text?: string}) {
    function handleLogin() {
        const loginBtn = document.getElementById("login-btn");
        if (loginBtn) {
            loginBtn.click();
        }
    }
    return (
        <section className="px-10 py-5 space-y-6 flex items-center justify-center flex-col">
            <h1 className="text-2xl text-center font-bold">{text}</h1>
            <Button className="bg-pastypink hover:bg-gray-200" onClick={handleLogin}>Login</Button>
        </section>
    )
}