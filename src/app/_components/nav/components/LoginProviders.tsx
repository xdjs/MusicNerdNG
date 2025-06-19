"use client"
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactNode, Suspense } from "react";
import dynamic from 'next/dynamic';
import { WagmiProvider as WagmiProviderBase, http, createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';

const queryClient = new QueryClient();

// Dynamically import wallet-related components
const WalletProviders = dynamic(
    async () => {
        const { getDefaultConfig, RainbowKitProvider } = await import('@rainbow-me/rainbowkit');
        const { http } = await import('wagmi');
        const { mainnet: rkMainnet } = await import('wagmi/chains');
        const { RainbowKitSiweNextAuthProvider } = await import('@rainbow-me/rainbowkit-siwe-next-auth');

        const projectId = '929ab7024658ec19d047d5df44fb0f63';

        const config = getDefaultConfig({
            appName: 'Music Nerd',
            projectId,
            chains: [rkMainnet],
            transports: {
                [rkMainnet.id]: http()
            },
            ssr: true
        });

        return function Providers({ children }: { children: ReactNode }) {
            return (
                <WagmiProviderBase config={config}>
                    <QueryClientProvider client={queryClient}>
                        <RainbowKitSiweNextAuthProvider
                            getSiweMessageOptions={() => ({
                                statement: 'Sign in to MusicNerd to add artists and manage your collection.',
                                nonce: undefined,
                                chainId: undefined,
                                domain: window.location.host,
                                uri: window.location.origin,
                                expirationTime: new Date(Date.now() + 1000 * 60 * 5).toISOString(), // 5 minutes from now
                            })}
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
                </WagmiProviderBase>
            );
        };
    },
    {
        ssr: false, // This ensures the component only loads on the client side
        loading: () => null // Remove loading message
    }
);

// Minimal Wagmi config for walletless mode (no connectors)
const walletlessConfig = createConfig({
    chains: [mainnet],
    transports: {
        [mainnet.id]: http(),
    },
    ssr: true,
});

function NonWalletContent({ children }: { children: ReactNode }) {
    return (
        <WagmiProviderBase config={walletlessConfig}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </WagmiProviderBase>
    );
}

export default function LoginProviders({ children }: { children: ReactNode }) {
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

    const isWalletRequired = !walletlessEnabled;

    if (!isWalletRequired) {
        return <NonWalletContent>{children}</NonWalletContent>;
    }

    return (
        <Suspense fallback={null}>
            <WalletProviders>{children}</WalletProviders>
        </Suspense>
    );
}