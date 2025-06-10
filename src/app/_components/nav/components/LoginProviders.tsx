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
            ssr: true
        });

        return function Providers({ children }: { children: ReactNode }) {
            return (
                <WagmiProvider config={config}>
                    <QueryClientProvider client={queryClient}>
                        <RainbowKitSiweNextAuthProvider
                            getSiweMessageOptions={() => {
                                // Clear any existing SIWE data to force a new message
                                if (typeof window !== 'undefined') {
                                    // Clear CSRF token cookie
                                    document.cookie = 'next-auth.csrf-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';
                                    
                                    // Clear SIWE-related storage
                                    sessionStorage.removeItem('siwe-nonce');
                                    localStorage.removeItem('siwe.session');
                                    localStorage.removeItem('wagmi.siwe.message');
                                    localStorage.removeItem('wagmi.siwe.signature');
                                }
                                
                                return {
                                    statement: 'Sign in to MusicNerd to add artists and manage your collection.',
                                    // Let RainbowKit handle these values
                                    nonce: undefined,
                                    chainId: undefined,
                                    expirationTime: new Date(Date.now() + 1000 * 60 * 5).toISOString(), // 5 minutes from now
                                };
                            }}
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
        loading: () => null // Remove loading message
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
        <Suspense fallback={null}>
            <WalletProviders>{children}</WalletProviders>
        </Suspense>
    );
}