"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { Button } from "@/components/ui/button";
import { useEffect, useState } from 'react';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import LoginProviders from './LoginProviders';

export default function Wrapper({ buttonText, buttonStyles = "", isplaceholder = false }: { buttonText?: string, buttonStyles: string, isplaceholder?: boolean }) {
    return (
        <LoginProviders>
            <Login buttonText={buttonText} buttonStyles={buttonStyles} isplaceholder={isplaceholder} />
        </LoginProviders>
    )
}

function Login({ buttonText, buttonStyles = "", isplaceholder = false }: { buttonText?: string, buttonStyles: string, isplaceholder?: boolean }) {

    const { data: session, status } = useSession();
    const router = useRouter();
    const [currentStatus, setCurrentStatus] = useState(status);

    useEffect(() => {
        // Refresh that page if the user is authenticated or unauthenticated
        if (currentStatus !== status && currentStatus !== "loading") {
            setCurrentStatus(status);
            // Refresh the page once the login is successful
            router.refresh();
        }
        setCurrentStatus(status);
    }, [status, currentStatus]); // Depend on session status

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
                    // Note: If your app doesn't use authentication, you
                    // can remove all 'authenticationStatus' checks
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

