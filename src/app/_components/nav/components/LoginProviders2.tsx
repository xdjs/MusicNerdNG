import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { WagmiProvider } from 'wagmi';
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
import { SessionProvider } from 'next-auth/react';


const queryClient = new QueryClient();

const config = getDefaultConfig({
    appName: 'fsot',
    projectId: '929ab7024658ec19d047d5df44fb0f63',
    chains: [mainnet, polygon, optimism, arbitrum, base],
});



export default function LoginProviders2({ children }: { children: ReactNode }) {
    return (
        <SessionProvider>
            <WagmiProvider config={config}>
                <QueryClientProvider client={queryClient}>
                    {children}
                </QueryClientProvider>
            </WagmiProvider>
        </SessionProvider>    
        )
}

