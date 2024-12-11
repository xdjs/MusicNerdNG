"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { Button } from "@/components/ui/button";
import { useEffect } from 'react';
import { useRouter } from "next/navigation";

export default function Login({buttonText, buttonStyles=""} : {buttonText? : string, buttonStyles: string}) {
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
                    useEffect(() => {
                        router.refresh();
                    }, [authenticationStatus])
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
                                        <Button className={buttonStyles} onClick={openConnectModal} type="button">
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
    )
}

