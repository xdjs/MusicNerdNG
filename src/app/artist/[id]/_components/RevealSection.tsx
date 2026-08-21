"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

interface RevealSectionProps {
    children: ReactNode;
    className?: string;
    delay?: number;
    /** Anchor for the post-build tour to scroll to. The tour targets ids so it
     *  needs no knowledge of this page's layout. */
    id?: string;
}

export default function RevealSection({ children, className, delay = 0, id }: RevealSectionProps) {
    return (
        <motion.section
            id={id}
            className={className}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, ease: "easeOut", delay }}
        >
            {children}
        </motion.section>
    );
}
