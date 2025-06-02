"use client"
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactNode, Suspense } from "react";
import dynamic from 'next/dynamic';

const queryClient = new QueryClient();

// Dynamically import wallet-related components
const WalletProviders = dynamic(
    async () => {
        const { getDefaultConfig, RainbowKitProvider } = await import('@rainbow-me/rainbowkit');
        const { WagmiProvider, http } = await import('wagmi');
        const { RainbowKitSiweNextAuthProvider } = await import('@rainbow-me/rainbowkit-siwe-next-auth');
        const { mainnet } = await import('wagmi/chains');

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

        return function Providers({ children }: { children: ReactNode }) {
            return (
                <WagmiProvider config={config}>
                    <QueryClientProvider client={queryClient}>
                        <RainbowKitSiweNextAuthProvider
                            getSiweMessageOptions={() => ({
                                statement: 'Sign in to MusicNerd to add artists and manage your collection.',
                                nonce: undefined,
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
                </WagmiProvider>
            );
        };
    },
    {
        ssr: false, // This ensures the component only loads on the client side
        loading: () => <div>Loading wallet functionality...</div>
    }
);

// Component that excludes wagmi-dependent components
function NonWalletContent({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}

export default function LoginProviders({ children }: { children: ReactNode }) {
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';

    if (!isWalletRequired) {
        return <NonWalletContent>{children}</NonWalletContent>;
    }

    return (
        <Suspense fallback={<div>Loading wallet functionality...</div>}>
            <WalletProviders>{children}</WalletProviders>
        </Suspense>
    );
}