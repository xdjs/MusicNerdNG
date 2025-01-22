"use client";
import LoginProviders from "@/app/_components/nav/components/LoginProviders";
import LoginButton from "@/app/_components/nav/components/Login";

export default function Login() {
    return (
        <LoginProviders>
            <LoginButton buttonStyles="bg-blue-500 text-white" />
        </LoginProviders>
    );
}