"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { Button } from "@/components/ui/button";
import { useEffect, useState } from 'react';
import { useSession } from "next-auth/react";
import { Wallet } from 'lucide-react';


export default  function Login({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false }: { buttonChildren?: React.ReactNode, buttonStyles: string, isplaceholder?: boolean }) {

    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);

    useEffect(() => {
        console.log("currentStatus", status)
        // Refresh that page if the user is authenticated or unauthenticated
        if (currentStatus !== status && currentStatus !== "loading") {
            setCurrentStatus(status);
            console.log("refreshing page")
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
                const ready = mounted && authenticationStatus !== 'loading';
                const connected =
                    ready &&
                    account &&
                    chain &&
                    (authenticationStatus === 'authenticated');

                if (!ready) {
                    return (
                        <Button className={` bg-gray-400 animate-pulse w-12 h-12 px-0`} size="lg" onClick={openConnectModal} type="button" >
                        </Button>
                    )
                }

                return (
                    <div
                    >
                        {(() => {
                            if (!connected) {
                                return (
                                    <Button className={`hover:bg-gray-200 transition-colors duration-300 text-black px-0 w-12 h-12 bg-pastypink ${buttonStyles}`} id="login-btn" size="lg" onClick={openConnectModal} type="button" >
                                        {buttonChildren ?? <Wallet color="white" />}
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
                                    <Button onClick={openAccountModal} type="button" className="bg-pastypink text-black px-3  hover:bg-gray-200 transition-colors duration-300" size="lg" >
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

