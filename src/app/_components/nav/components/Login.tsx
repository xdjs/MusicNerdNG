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
    const [currentStatus, setCurrentStatus] = useState(status);

    useEffect(() => {
        // Refresh that page if the user is authenticated or unauthenticated
        if (currentStatus !== status && currentStatus !== "loading") {
            setCurrentStatus(status);
            // Refresh the page once the login is successful
            location.reload();
        }
        setCurrentStatus(status);
    }, [status, currentStatus]); // Depend on session status

    return (
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
                                    <Button className={`${buttonStyles} hover:opacity-75 bg-gray-100 text-black`} size="lg" onClick={openConnectModal} type="button" >
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
                                    <Button onClick={openAccountModal} type="button" className="bg-pastypink text-black px-3" size="lg" >
                                        {isplaceholder ? <img className="max-h-6" src="/spinner.svg" alt="whyyyyy" />
                                            : <label className="text-xl">🥳</label>
                                            }
                                        
                                    </Button>
                                </div>
                            );
                        })()}
                    </div>
                );
            }}
        </ConnectButton.Custom>
    )
}

