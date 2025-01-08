"use client"
import { SessionProvider } from "next-auth/react";
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { WagmiProvider } from 'wagmi';
import {
    RainbowKitSiweNextAuthProvider,
    GetSiweMessageOptions,
} from '@rainbow-me/rainbowkit-siwe-next-auth';
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
import { ReactNode } from "react";

const queryClient = new QueryClient();

const config = getDefaultConfig({
    appName: 'fsot',
    projectId: '929ab7024658ec19d047d5df44fb0f63',
    chains: [mainnet, polygon, optimism, arbitrum, base],
});

const getSiweMessageOptions: GetSiweMessageOptions = () => ({
    statement: 'Sign in to MusicNerd',
});

export default function LoginProviders({ children }: { children: ReactNode }) {
    return (
        <SessionProvider>
            <WagmiProvider config={config}>
                <QueryClientProvider client={queryClient}>
                    <RainbowKitSiweNextAuthProvider
                        getSiweMessageOptions={getSiweMessageOptions}
                    >
                        <RainbowKitProvider>
                            {children}
                        </RainbowKitProvider>
                    </RainbowKitSiweNextAuthProvider>
                </QueryClientProvider>
            </WagmiProvider>
        </SessionProvider>
    )
}