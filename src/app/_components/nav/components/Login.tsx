"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { Button } from "@/components/ui/button";
import LoginProviders from './LoginProviders';
import { useSession } from "next-auth/react";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Wrapper({ buttonText, buttonStyles = "", isplaceholder = false }: { buttonText?: string, buttonStyles: string, isplaceholder?: boolean }) {
    return (
        <LoginProviders>
            <Login buttonText={buttonText} buttonStyles={buttonStyles} isplaceholder={isplaceholder} />
        </LoginProviders>
    )
}

function Login({ buttonText, buttonStyles = "", isplaceholder = false }: { buttonText?: string, buttonStyles: string, isplaceholder?: boolean }) {
    const router = useRouter();    
    return (
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
                    const ready = mounted && authenticationStatus !== 'loading';
                
                    const connected =
                        ready &&
                        account &&
                        chain &&
                        (authenticationStatus === 'authenticated');
                        
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
                                        <Button className={`${buttonStyles} hover:opacity-75`} onClick={openConnectModal} type="button">
                                            {buttonText ?? "Connect Wallet"}
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
                                            {isplaceholder ? <img className="max-h-6" src="/spinner.svg" alt="whyyyyy" />
                                                : account.displayName}
                                        </Button>
                                    </div>
                                );
                            })()}
                        </div>
                    );
                }}
            </ConnectButton.Custom>
        </div>
    )
}

