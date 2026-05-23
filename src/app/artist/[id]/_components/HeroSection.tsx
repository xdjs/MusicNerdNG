"use client";

import { useRef, useContext, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import StickyHeroBar from "./StickyHeroBar";
import { EditModeContext } from "@/app/_components/EditModeContext";
import { useToast } from "@/hooks/use-toast";

interface HeroSectionProps {
    imageUrl: string;
    artistName: string;
    artistId: string;
}

export default function HeroSection({ imageUrl, artistName, artistId }: HeroSectionProps) {
    const heroRef = useRef<HTMLDivElement>(null);
    const { isEditing } = useContext(EditModeContext);
    const { toast } = useToast();
    const [img, setImg] = useState(imageUrl);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    async function handleImageUpload(file: File) {
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("artistId", artistId);
            const res = await fetch("/api/artist/profile-image", { method: "POST", body: fd });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.imagePath) {
                setImg(data.imagePath);
                toast({ title: "Photo updated" });
            } else {
                toast({ title: "Couldn't update photo", description: data.error || "Upload failed", variant: "destructive" });
            }
        } catch {
            toast({ title: "Couldn't update photo", description: "Network error", variant: "destructive" });
        } finally {
            setUploading(false);
        }
    }

    const { scrollYProgress } = useScroll({
        target: heroRef,
        offset: ["start start", "end start"],
    });

    // Parallax: background moves at half speed
    const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);

    // Background fades out as you scroll past
    const bgOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

    // Profile photo scales down smoothly
    const photoScale = useTransform(scrollYProgress, [0, 0.8], [1, 0.65]);
    const photoOpacity = useTransform(scrollYProgress, [0.6, 0.9], [1, 0]);

    // Sticky bar fades in smoothly — pure motion value, no React state
    const stickyOpacity = useTransform(scrollYProgress, [0.7, 0.9], [0, 1]);

    return (
        <>
            <StickyHeroBar imageUrl={img} artistName={artistName} opacity={stickyOpacity} />

            <div ref={heroRef} className="relative w-full h-56 md:h-72 rounded-2xl overflow-hidden">
                {/* Blurred background with parallax + pink tint for depth on dark images */}
                <motion.div
                    className="absolute inset-0"
                    style={{ y: bgY, opacity: bgOpacity }}
                >
                    <img
                        src={img}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 brightness-125"
                    />
                    {/* Subtle pink/purple tint so dark images still show parallax depth */}
                    <div className="absolute inset-0 bg-gradient-to-br from-[#ef95ff]/20 via-transparent to-[#7c3aed]/15" />
                </motion.div>
                {/* Dark gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/50" />
                {/* Sharp centered photo with glass ring */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                        className="relative rounded-full p-1 backdrop-blur-md bg-white/20 dark:bg-white/10 border border-white/30 shadow-xl transition-shadow duration-300 hover:shadow-[0_0_25px_rgba(239,149,255,0.5)]"
                        style={{ scale: photoScale, opacity: photoOpacity }}
                    >
                        <img
                            src={img}
                            alt={artistName}
                            className="w-32 h-32 md:w-40 md:h-40 rounded-full object-cover"
                        />
                        {isEditing && (
                            <>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={e => {
                                        const f = e.target.files?.[0];
                                        if (f) handleImageUpload(f);
                                        e.target.value = "";
                                    }}
                                />
                                <button
                                    type="button"
                                    aria-label="Change photo"
                                    onClick={() => fileRef.current?.click()}
                                    className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white text-xs opacity-0 hover:opacity-100 transition-opacity"
                                >
                                    {uploading ? "Uploading…" : "Change photo"}
                                </button>
                            </>
                        )}
                    </motion.div>
                </div>
            </div>
        </>
    );
}
