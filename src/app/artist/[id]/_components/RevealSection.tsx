"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

interface RevealSectionProps {
    children: ReactNode;
    className?: string;
    delay?: number;
}

export default function RevealSection({ children, className, delay = 0 }: RevealSectionProps) {
    return (
        <motion.section
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
