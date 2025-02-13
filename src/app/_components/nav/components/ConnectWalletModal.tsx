"use client"
import { Dialog, DialogTrigger, DialogTitle, DialogHeader, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { injected, walletConnect, metaMask, coinbaseWallet } from 'wagmi/connectors';
import { useSignMessage } from 'wagmi';
import { useAccount, useConnect } from 'wagmi';
import { SiweMessage } from 'siwe';
import { getCsrfToken, signIn, useSession, signOut } from "next-auth/react"
import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";



export default function ConnectWalletModal({children}: {children: ReactNode}) {
    const { signMessageAsync } = useSignMessage()
    const { address, isConnected } = useAccount()
    const { connect } = useConnect()
    const router = useRouter();

    const { data: session, status } = useSession();


    const handleLogin = async () => {
        try {
            const message = new SiweMessage({
                domain: window.location.host,
                address: address,
                statement: "Sign in with Ethereum to MusicNerd.",
                uri: window.location.origin,
                version: "1",
                chainId: 1,
                nonce: await getCsrfToken(),
            })
            const signature = await signMessageAsync({
                message: message.prepareMessage(),
            })
            signIn("credentials", {
                message: JSON.stringify(message),
                redirect: false,
                signature,
            }).then(() => {
                console.log("refreshing")
                location.reload();
            })
        } catch (error) {
            console.log(error)
        }
    }

    useEffect(() => {
        if (isConnected && !session) {
            handleLogin()
        }
    }, [isConnected])

    function Login(connector: any){
        connect({ connector })
    }

    return (
        <Dialog>
            <DialogTrigger asChild> 
                {children}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect Wallet</DialogTitle>
                </DialogHeader>
                <Button onClick={() => Login(injected())}>MetaMask</Button>
                <Button onClick={() => Login(coinbaseWallet())}>Coinbase Wallet</Button>
                <Button onClick={() => Login(walletConnect({ projectId: "929ab7024658ec19d047d5df44fb0f63" }))}>WalletConnect</Button>
            </DialogContent>
        </Dialog>   
    )
}
