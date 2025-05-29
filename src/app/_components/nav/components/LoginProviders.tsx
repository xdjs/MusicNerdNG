"use client"
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { WagmiProvider, createConfig, http } from 'wagmi';
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

const config = createConfig({
    chains: [mainnet, polygon, optimism, arbitrum, base],
    transports: {
        [mainnet.id]: http(
            `https://rpc.walletconnect.com/v1?chainId=${mainnet.id}&projectId=${projectId}`
        ),
        [polygon.id]: http(
            `https://rpc.walletconnect.com/v1?chainId=${polygon.id}&projectId=${projectId}`
        ),
        [optimism.id]: http(
            `https://rpc.walletconnect.com/v1?chainId=${optimism.id}&projectId=${projectId}`
        ),
        [arbitrum.id]: http(
            `https://rpc.walletconnect.com/v1?chainId=${arbitrum.id}&projectId=${projectId}`
        ),
        [base.id]: http(
            `https://rpc.walletconnect.com/v1?chainId=${base.id}&projectId=${projectId}`
        ),
    },
    ssr: true,
});

const getSiweMessageOptions: GetSiweMessageOptions = () => ({
    statement: 'Sign in to MusicNerd to add artists and manage your collection.',
    nonce: undefined, // Let RainbowKit handle the nonce
    expirationTime: new Date(Date.now() + 1000 * 60 * 5).toISOString(), // 5 minutes from now
});

export default function LoginProviders({ children }: { children: ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitSiweNextAuthProvider
                    getSiweMessageOptions={getSiweMessageOptions}
                >
                    <RainbowKitProvider 
                        modalSize="compact"
                        showRecentTransactions={true}
                        appInfo={{
                            appName: 'Music Nerd',
                            learnMoreUrl: 'https://www.musicnerd.xyz',
                        }}
                    >
                        {children}
                    </RainbowKitProvider>
                </RainbowKitSiweNextAuthProvider>
            </QueryClientProvider>
        </WagmiProvider>
    )
}