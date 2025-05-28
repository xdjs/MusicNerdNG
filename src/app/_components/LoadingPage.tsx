"use client"

import { useEffect } from 'react';

export default function LoadingPage({ message = "Loading..." }: { message?: string }) {
    // Prevent scrolling while loading
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    return (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center gap-4">
            <div className="bg-white p-8 rounded-xl shadow-lg flex flex-col items-center gap-4">
                <img className="h-12" src="/spinner.svg" alt="Loading" />
                <div className="text-xl text-gray-600">{message}</div>
            </div>
        </div>
    );
} 