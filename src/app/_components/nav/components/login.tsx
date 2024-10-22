"use client"
import { SessionProvider } from "next-auth/react";

// Provider imports
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { ConnectButton, RainbowKitAuthenticationProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { WagmiProvider } from 'wagmi';

import {
    RainbowKitSiweNextAuthProvider,
    GetSiweMessageOptions,
} from '@rainbow-me/rainbowkit-siwe-next-auth';

import { Button } from "@/components/ui/button";

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
import { useEffect } from "react";
const queryClient = new QueryClient();

const config = getDefaultConfig({
    appName: 'fsot',
    projectId: '929ab7024658ec19d047d5df44fb0f63',
    chains: [mainnet, polygon, optimism, arbitrum, base],
});

const getSiweMessageOptions: GetSiweMessageOptions = () => ({
    statement: 'Sign in to MusicNerd',
});

function InnerProviders() {

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitSiweNextAuthProvider
                    getSiweMessageOptions={getSiweMessageOptions}
                >
                    <RainbowKitProvider>
                        <div className="justify-items-end">
                            <ConnectButton.Custom>
                                {({
                                    account,
                                    chain,
                                    openAccountModal,
                                    openChainModal,
                                    openConnectModal,
                                    authenticationStatus,
                                    mounted,
                                }) => {
                                    // Note: If your app doesn't use authentication, you
                                    // can remove all 'authenticationStatus' checks
                                    const ready = mounted && authenticationStatus !== 'loading';
                                    const connected =
                                        ready &&
                                        account &&
                                        chain &&
                                        (authenticationStatus === 'authenticated');

                                    useEffect(() => {
                                       console.log(authenticationStatus)
                                    }, [authenticationStatus]);

                                    // useEffect(() => { console.log(connected)}, [connected]);

                                    return (
                                        <div
                                            {...(!ready && {
                                                'aria-hidden': true,
                                                'style': {
                                                    opacity: 0,
                                                    pointerEvents: 'none',
                                                    userSelect: 'none',
                                                },
                                            })}
                                        >
                                            {(() => {
                                                if (!connected) {
                                                    return (
                                                        <Button onClick={openConnectModal} type="button">
                                                            Connect Wallet
                                                        </Button>
                                                    );
                                                }

                                                if (chain.unsupported) {
                                                    return (
                                                        <button onClick={openChainModal} type="button">
                                                            Wrong network
                                                        </button>
                                                    );
                                                }

                                                return (
                                                    <div style={{ display: 'flex', gap: 12 }}>
                                                        <Button onClick={openAccountModal} type="button">
                                                            {account.displayName}
                                                        </Button>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    );
                                }}
                            </ConnectButton.Custom>
                        </div>
                    </RainbowKitProvider>
                </RainbowKitSiweNextAuthProvider>
            </QueryClientProvider>
        </WagmiProvider>
    )
}

export default function Login() {
    return (
        <SessionProvider>
            <InnerProviders/>
        </SessionProvider>
    )
}