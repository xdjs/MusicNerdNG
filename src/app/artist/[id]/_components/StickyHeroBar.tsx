"use client";

import { motion, type MotionValue } from "framer-motion";

interface StickyHeroBarProps {
    imageUrl: string;
    artistName: string;
    /** 0 = hidden, 1 = fully visible — driven by scroll, no React state */
    opacity: MotionValue<number>;
}

export default function StickyHeroBar({ imageUrl, artistName, opacity }: StickyHeroBarProps) {
    return (
        <motion.div
            style={{ opacity }}
            className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-white/60 dark:bg-black/50 border-b border-white/20 dark:border-white/10 shadow-sm pointer-events-none"
        >
            <div className="max-w-[800px] mx-auto px-4 py-2 flex items-center gap-3">
                <img
                    src={imageUrl}
                    alt={artistName}
                    className="w-8 h-8 rounded-full object-cover border border-white/30"
                />
                <span className="text-sm font-semibold text-black dark:text-white truncate">
                    {artistName}
                </span>
            </div>
        </motion.div>
    );
}
