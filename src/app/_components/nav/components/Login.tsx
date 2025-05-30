"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback, forwardRef } from 'react';
import { useSession, signOut } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import { useAccount, useDisconnect, useConfig } from 'wagmi';
import { useConnectModal, useAccountModal, useChainModal } from '@rainbow-me/rainbowkit';

const Login = forwardRef<HTMLButtonElement, { 
    buttonChildren?: React.ReactNode, 
    buttonStyles: string, 
    isplaceholder?: boolean 
}>(({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false }, ref) => {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const { isConnected, address } = useAccount();
    const { disconnect } = useDisconnect();
    const config = useConfig();

    // Handle disconnection and cleanup
    const handleDisconnect = useCallback(async () => {
        try {
            console.log("[Login] Disconnecting wallet and cleaning up session");
            await signOut({ redirect: false });
            disconnect();
            
            // Clear all auth-related flags
            sessionStorage.removeItem('searchFlow');
            sessionStorage.removeItem('directLogin');
            sessionStorage.removeItem('currentPath');
            
            toast({
                title: "Disconnected",
                description: "Your wallet has been disconnected",
            });
        } catch (error) {
            console.error("[Login] Error during disconnect:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to disconnect wallet"
            });
        }
    }, [disconnect, toast]);

    useEffect(() => {
        console.log("[Login] State changed:", {
            authFrom: currentStatus,
            authTo: status,
            isConnected,
            address,
            sessionUser: session?.user,
            isSearchFlow: sessionStorage.getItem('searchFlow')
        });

        if (status !== currentStatus) {
            setCurrentStatus(status);
        }

        // Clean up search flow flag if we're authenticated
        if (status === "authenticated") {
            sessionStorage.removeItem('searchFlow');
            sessionStorage.removeItem('directLogin');
        }
    }, [status, currentStatus, isConnected, address, session]);

    return (
        <ConnectButton.Custom>
            {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                mounted,
            }) => {
                const ready = mounted;

                if (!ready || !config) {
                    return (
                        <Button className="bg-pastypink animate-pulse w-12 h-12 px-0" size="lg" type="button">
                            <img className="max-h-6" src="/spinner.svg" alt="Loading..." />
                        </Button>
                    );
                }

                if (!isConnected || status !== "authenticated") {
                    console.log("[Login] User not connected or not authenticated, showing connect button");
                    return (
                        <Button 
                            ref={ref}
                            className={`hover:bg-gray-200 transition-colors duration-300 text-black px-0 w-12 h-12 bg-pastypink ${buttonStyles}`} 
                            id="login-btn" 
                            size="lg" 
                            onClick={() => {
                                if (openConnectModal) {
                                    // If we're not in the search flow, set a flag to indicate this is a direct login
                                    if (!sessionStorage.getItem('searchFlow')) {
                                        sessionStorage.setItem('directLogin', 'true');
                                    }
                                    openConnectModal();
                                }
                            }}
                            type="button"
                        >
                            {buttonChildren ?? <Wallet color="white" />}
                        </Button>
                    );
                }

                console.log("[Login] User connected and authenticated, showing account button");
                return (
                    <div style={{ display: 'flex', gap: 12 }}>
                        <Button 
                            ref={ref}
                            onClick={openAccountModal}
                            type="button" 
                            className="bg-pastypink hover:bg-pastypink/80 transition-colors duration-300 w-12 h-12 p-0 flex items-center justify-center" 
                            size="lg"
                        >
                            {isplaceholder ? (
                                <img className="max-h-6" src="/spinner.svg" alt="Loading..." />
                            ) : (
                                <span className="text-xl">🥳</span>
                            )}
                        </Button>
                    </div>
                );
            }}
        </ConnectButton.Custom>
    );
});

Login.displayName = 'Login';

export default Login;

