"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { ShieldCheck, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { claimArtistProfile } from "@/app/actions/dashboardActions";

interface ClaimButtonProps {
    artistId: string;
    isClaimed: boolean;
    isClaimedByUser: boolean;
    isPending?: boolean;
    isPendingByUser?: boolean;
    artistInstagram?: string | null;
}

export default function ClaimButton({
    artistId,
    isClaimed,
    isClaimedByUser,
    isPending = false,
    isPendingByUser = false,
    artistInstagram,
}: ClaimButtonProps) {
    const { data: session } = useSession();
    const [modalOpen, setModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [referenceCode, setReferenceCode] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const { toast } = useToast();

    // Claimed or pending by another user — hide button
    if ((isClaimed && !isClaimedByUser) || (isPending && !isPendingByUser)) {
        return null;
    }

    // Already claimed by current user — show badge
    if (isClaimedByUser) {
        return (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-pastypink/15 text-pastypink text-xs font-semibold">
                <ShieldCheck size={14} strokeWidth={2.5} />
                <span>Claimed</span>
            </div>
        );
    }

    // Pending by current user — show pending badge
    if (isPendingByUser) {
        return (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/15 text-amber-500 text-xs font-semibold">
                <ShieldCheck size={14} strokeWidth={2.5} />
                <span>Pending Verification</span>
            </div>
        );
    }

    const handleClaim = async () => {
        setLoading(true);
        try {
            const result = await claimArtistProfile(artistId);
            if (result.success && result.referenceCode) {
                setReferenceCode(result.referenceCode);
            } else if (result.alreadyClaimed) {
                toast({
                    title: "Already Claimed",
                    description: "This artist profile has already been claimed.",
                    variant: "destructive",
                });
                setModalOpen(false);
            } else {
                toast({
                    title: "Error",
                    description: result.error ?? "Failed to claim profile.",
                    variant: "destructive",
                });
            }
        } catch {
            toast({
                title: "Error",
                description: "Something went wrong. Please try again.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const copyCode = async () => {
        if (!referenceCode) return;
        await navigator.clipboard.writeText(referenceCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    if (!session) {
                        // Trigger login via the nav login button
                        const loginBtn = document.getElementById('login-btn');
                        if (loginBtn) loginBtn.click();
                        return;
                    }
                    setModalOpen(true);
                }}
                className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200",
                    "bg-white text-pastypink border border-pastypink/50 hover:bg-pastypink hover:text-white"
                )}
            >
                <ShieldCheck size={14} strokeWidth={2.5} />
                Claim
            </Button>

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-foreground">Claim This Profile</DialogTitle>
                        <DialogDescription>
                            Verify your identity to manage this artist profile.
                        </DialogDescription>
                    </DialogHeader>

                    {!referenceCode ? (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                To verify you are this artist, we&apos;ll generate a reference code.
                                DM <strong>@musicnerdxyz</strong> on Instagram from your official
                                artist account with this code.
                            </p>

                            {!artistInstagram && (
                                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3">
                                    <p className="text-xs text-amber-600 dark:text-amber-400">
                                        This profile doesn&apos;t have an Instagram link yet. Consider adding
                                        your Instagram first so we can verify your identity more easily.
                                    </p>
                                </div>
                            )}

                            <Button
                                onClick={handleClaim}
                                disabled={loading}
                                className="w-full bg-pastypink hover:bg-pastypink/90 text-white"
                            >
                                {loading ? "Submitting..." : "Submit Claim"}
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Your claim has been submitted! Send this code to{" "}
                                <strong>@musicnerdxyz</strong> on Instagram from your official account:
                            </p>

                            <div className="flex items-center justify-center gap-2 p-4 rounded-lg bg-muted">
                                <span className="text-2xl font-mono font-bold tracking-wider text-foreground">
                                    {referenceCode}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={copyCode}
                                    className="h-8 w-8 p-0"
                                >
                                    {copied ? <Check size={16} /> : <Copy size={16} />}
                                </Button>
                            </div>

                            <a
                                href="https://www.instagram.com/musicnerdxyz/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 w-full rounded-lg border border-pastypink/50 px-4 py-2 text-sm font-medium text-pastypink hover:bg-pastypink/10 transition-colors"
                            >
                                Open @musicnerdxyz on Instagram
                                <ExternalLink size={14} />
                            </a>

                            <p className="text-xs text-muted-foreground text-center">
                                We&apos;ll review your claim and approve it once verified.
                            </p>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
