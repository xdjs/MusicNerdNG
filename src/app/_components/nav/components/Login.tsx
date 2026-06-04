"use client"
import { forwardRef } from 'react';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import PrivyLogin from './PrivyLogin';

interface LoginProps {
    buttonStyles?: string;
}

// Check if Privy is configured
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

// Component for non-wallet mode (walletless dev mode)
const isLocalEnvironment = typeof window === 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const NoWalletLogin: React.FC<LoginProps> = ({ buttonStyles }) => {
    return (
        <div className="flex items-center gap-1.5">
            {isLocalEnvironment && (
                <>
                    <Link
                        href="/admin"
                        title="Admin panel"
                        aria-label="Admin panel"
                        className={`flex items-center justify-center w-10 h-10 rounded-lg bg-pastypink hover:bg-pastypink/80 transition-colors duration-300 text-white ${buttonStyles}`}
                    >
                        <Settings size={18} />
                    </Link>
                </>
            )}
        </div>
    );
};

// Main component that decides which version to render
const Login = forwardRef<HTMLButtonElement, LoginProps>((props, ref): React.ReactElement => {
    // Skip Privy login if not configured (e.g., during CI build)
    if (!PRIVY_APP_ID) {
        return <NoWalletLogin {...props} />;
    }

    // Use Privy-based login (email-first authentication)
    return <PrivyLogin buttonStyles={props.buttonStyles} ref={ref} />;
});

Login.displayName = 'Login';

export default Login;
