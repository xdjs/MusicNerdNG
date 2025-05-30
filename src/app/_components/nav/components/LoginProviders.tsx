"use client"
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { WagmiProvider, http } from 'wagmi';
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

const projectId = '929ab7024658ec19d047d5df44fb0f63';

const config = getDefaultConfig({
    appName: 'Music Nerd',
    projectId,
    chains: [mainnet],
    transports: {
        [mainnet.id]: http()
    },
    ssr: true,
});

const getSiweMessageOptions: GetSiweMessageOptions = () => ({
    statement: 'Sign in to MusicNerd to add artists and manage your collection.',
    nonce: undefined,
    expirationTime: new Date(Date.now() + 1000 * 60 * 5).toISOString(), // 5 minutes from now
});

export default function LoginProviders({ children }: { children: ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitSiweNextAuthProvider
                    getSiweMessageOptions={getSiweMessageOptions}
                    enabled={true}
                >
                    <RainbowKitProvider 
                        modalSize="compact"
                        showRecentTransactions={true}
                        appInfo={{
                            appName: 'Music Nerd',
                            learnMoreUrl: 'https://www.musicnerd.xyz',
                            disclaimer: undefined
                        }}
                    >
                        {children}
                    </RainbowKitProvider>
                </RainbowKitSiweNextAuthProvider>
            </QueryClientProvider>
        </WagmiProvider>
    )
}