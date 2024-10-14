"use client"
import { SessionProvider } from "next-auth/react";
import type { Session } from 'next-auth';

// Provider imports
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { ConnectButton, RainbowKitAuthenticationProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { useSession } from "next-auth/react"
import { WagmiProvider } from 'wagmi';
import { authenticationAdapter } from "@/lib/authAdapter";

import {
    RainbowKitSiweNextAuthProvider,
    GetSiweMessageOptions,
} from '@rainbow-me/rainbowkit-siwe-next-auth';

const commands = [
    { value: "0x909014aa345e2A6Fb302618Cd6F4f001A6ef17b7", label: "Jae" },
    { value: "0xaEA50B85f24415f4F7bD1409e0B537db04FadaeC", label: "Collin" },
];

import {
    QueryClientProvider,
    QueryClient,
} from "@tanstack/react-query";
import {
    mainnet,
    polygon,
    optimism,
    arbitrum,
    base,
} from 'wagmi/chains';
const queryClient = new QueryClient();

const config = getDefaultConfig({
    appName: 'fsot',
    projectId: '929ab7024658ec19d047d5df44fb0f63',
    chains: [mainnet, polygon, optimism, arbitrum, base],
    ssr: true, // If your dApp uses server side rendering (SSR)
});

const getSiweMessageOptions: GetSiweMessageOptions = () => ({
    statement: 'Sign in to the RainbowKit + SIWE example app',
});

function InnerProviders() {
    const { status, data } = useSession();

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitSiweNextAuthProvider
                    getSiweMessageOptions={getSiweMessageOptions}
                >
                    <RainbowKitProvider>
                        <div className="justify-items-end">
                            <ConnectButton
                                accountStatus="avatar"
                                chainStatus="none"
                                showBalance={false}
                            />
                        </div>
                    </RainbowKitProvider>
                </RainbowKitSiweNextAuthProvider>
            </QueryClientProvider>
        </WagmiProvider>
    )
}

export default function Login({
    pageProps
}: {
    pageProps: Session;
}) {
    return (
        <SessionProvider session={pageProps}>
            <InnerProviders />
        </SessionProvider>
    )
}