"use client"
import { getCsrfToken, signIn, useSession, signOut } from "next-auth/react"
import { SiweMessage } from "siwe";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { ReactNode, useEffect, useState } from "react";
import ConnectWalletModal from "./ConnectWalletModal";
import { Button } from "@/components/ui/button";
import LoginProviders2 from "./LoginProviders2";

export default function Wrapper({ children }: { children: ReactNode }) {
    return (
        <LoginProviders2>
            <Login2>
                {children}
            </Login2>
        </LoginProviders2>
    )
}

function Login2({children}: {children: ReactNode}) {
    const { data: session, status } = useSession();
    return (
        <>
            {session ?
                <Button onClick={() => signOut()}>Logout</Button> :
                <ConnectWalletModal>
                    {children}
                </ConnectWalletModal>
            }
        </>
    )
}

