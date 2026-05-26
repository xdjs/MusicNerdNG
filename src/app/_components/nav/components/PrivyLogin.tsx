'use client';

import { usePrivy, useLogin, useLogout, useIdentityToken, getIdentityToken } from '@privy-io/react-auth';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useEffect, useRef, useState, useCallback, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Link from 'next/link';
import { LogIn } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/app/_components/ThemeProvider';
import { LegacyAccountModal } from './LegacyAccountModal';
import { TOKEN_PREFIXES } from '@/server/utils/privyConstants';

interface PrivyLoginProps {
  buttonStyles?: string;
}

const isDev = process.env.NODE_ENV === 'development';
const LEGACY_MODAL_SHOWN_KEY = 'legacyModalShown';

// Retry configuration from environment variables
const maxRetries = parseInt(process.env.NEXT_PUBLIC_PRIVY_TOKEN_MAX_RETRIES || '5', 10);
const retryDelay = parseInt(process.env.NEXT_PUBLIC_PRIVY_TOKEN_RETRY_DELAY_MS || '500', 10);

const PrivyLogin = forwardRef<HTMLButtonElement, PrivyLoginProps>(
  ({ buttonStyles = '' }, ref) => {
    const { ready, authenticated, user: privyUser, getAccessToken } = usePrivy();
    const { identityToken } = useIdentityToken();
    const { data: session, status } = useSession();
    const { toast } = useToast();
    const { theme, setTheme } = useTheme();
    const [showLegacyModal, setShowLegacyModal] = useState(false);
    const [hasPendingUGC, setHasPendingUGC] = useState(false);
    const [ugcCount, setUgcCount] = useState<number>(0);
    const [hasNewUGC, setHasNewUGC] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [pendingNextAuthLogin, setPendingNextAuthLogin] = useState(false);
    const [hasDashboardClaim, setHasDashboardClaim] = useState(false);
    const [claimedArtistId, setClaimedArtistId] = useState<string | null>(null);
    const reloadingRef = useRef(false);

    // Check for approved claim via API (replaces unreliable localStorage check)
    useEffect(() => {
      if (!session) {
        setHasDashboardClaim(false);
        setClaimedArtistId(null);
        return;
      }
      const controller = new AbortController();
      fetch("/api/user/has-claim", { signal: controller.signal })
        .then(r => r.json())
        .then(d => {
          setHasDashboardClaim(!!d.hasClaim);
          setClaimedArtistId(d.artistId ?? null);
        })
        .catch(() => {
          setHasDashboardClaim(false);
          setClaimedArtistId(null);
        });
      return () => controller.abort();
    }, [session]);

    const { login } = useLogin({
      onComplete: async (params) => {
        const { user, isNewUser, wasAlreadyAuthenticated } = params;
        if (isDev) {
          console.log('[PrivyLogin] onComplete called:', {
            userId: user?.id,
            isNewUser,
            wasAlreadyAuthenticated,
            currentAuthenticated: authenticated,
            currentReady: ready,
          });
        }
        // If Privy says already authenticated, only re-trigger NextAuth
        // if NextAuth is out of sync (split state from a previous failed update).
        if (wasAlreadyAuthenticated) {
          if (status === 'unauthenticated') {
            if (isDev) {
              console.log('[PrivyLogin] wasAlreadyAuthenticated but NextAuth unauthenticated — re-triggering login');
            }
            setIsLoggingIn(true);
            setPendingNextAuthLogin(true);
          }
          return;
        }
        // Set flag to trigger NextAuth login once Privy state is ready
        setIsLoggingIn(true);
        setPendingNextAuthLogin(true);
      },
      onError: (error) => {
        console.error('[PrivyLogin] Privy login error:', error);
        setIsLoggingIn(false);
        setPendingNextAuthLogin(false);
      },
    });

    // Handle NextAuth login after Privy authentication is complete
    useEffect(() => {
      const completeLogin = async () => {
        if (isDev) {
          console.log('[PrivyLogin] completeLogin check:', {
            pendingNextAuthLogin,
            authenticated,
            ready,
            hasPrivyUser: !!privyUser,
            privyUserId: privyUser?.id,
          });
        }

        if (!pendingNextAuthLogin || !authenticated || !ready) {
          return;
        }

        try {
          // Retry logic for getAccessToken - it may return null initially due to timing
          let token: string | null = null;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const authToken = await getAccessToken();
            if (isDev) {
              console.log('[PrivyLogin] getAccessToken result:', {
                attempt,
                hasToken: !!authToken,
                tokenLength: typeof authToken === 'string' ? authToken.length : 'not a string',
              });
            }

            // Handle case where getAccessToken might return an object with token property
            token = typeof authToken === 'string' ? authToken : (authToken as any)?.token || (authToken as any)?.accessToken || null;

            if (token) {
              break;
            }

            // Fallback: try identity token (available even when access token isn't)
            try {
              const idToken = await getIdentityToken();
              if (idToken) {
                token = `${TOKEN_PREFIXES.ID_TOKEN}${idToken}`;
                if (isDev) {
                  console.log('[PrivyLogin] Identity token obtained on attempt', attempt);
                }
                break;
              }
            } catch (idTokenError) {
              if (isDev) {
                console.log('[PrivyLogin] getIdentityToken failed:', idTokenError);
              }
            }

            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
          }

          if (!token) {
            // Final fallback: use Privy user ID directly (for test users that don't get tokens)
            // This path is intentionally blocked in production — verifyPrivyToken returns null
            // for privyid: prefixed tokens in production environments.
            if (process.env.NODE_ENV !== 'production' && privyUser?.id) {
              if (isDev) {
                console.log('[PrivyLogin] Using direct Privy ID fallback:', privyUser.id);
              }
              token = `${TOKEN_PREFIXES.PRIVY_ID}${privyUser.id}`;
            } else {
              console.error('[PrivyLogin] Failed to get auth token after all retries');
              toast({
                title: 'Login Error',
                description: process.env.NODE_ENV === 'production'
                  ? 'Authentication temporarily unavailable, please refresh the page.'
                  : 'Failed to get authentication token. Please try again.',
                variant: 'destructive',
              });
              return;
            }
          }

          // Sign in with NextAuth using the Privy provider
          const result = await signIn('privy', {
            authToken: token,
            redirect: false,
          });

          if (result?.error) {
            console.error('[PrivyLogin] NextAuth sign in failed:', result.error);
            toast({
              title: 'Login Error',
              description: 'Failed to complete login. Please try again.',
              variant: 'destructive',
            });
          } else {
            // SessionProvider with refetchInterval=0 doesn't auto-update after
            // signIn sets the cookie. Neither update() nor getSession() reliably
            // propagate to all useSession() consumers. Reload the page to ensure
            // all components (nav, profile, leaderboard) read the new session.
            reloadingRef.current = true;
            window.location.reload();
          }
        } catch (error) {
          console.error('[PrivyLogin] Login error:', error);
          toast({
            title: 'Login Error',
            description: 'An unexpected error occurred. Please try again.',
            variant: 'destructive',
          });
        } finally {
          if (!reloadingRef.current) {
            setIsLoggingIn(false);
            setPendingNextAuthLogin(false);
          }
        }
      };

      completeLogin();
    }, [pendingNextAuthLogin, authenticated, ready, getAccessToken, toast, privyUser]);

    const { logout: privyLogout } = useLogout({
      onSuccess: () => {
        if (isDev) {
          console.log('[PrivyLogin] Privy logout complete');
        }
      },
    });

    // Handle login click — if Privy is already authenticated but NextAuth isn't,
    // we have a stale/split session. Log out of Privy first, then start fresh.
    const handleLogin = useCallback(async () => {
      if (authenticated && status === 'unauthenticated') {
        if (isDev) {
          console.log('[PrivyLogin] Stale Privy session detected, logging out before fresh login');
        }
        setIsLoggingIn(true);
        try {
          await privyLogout();
        } catch (e) {
          if (isDev) {
            console.log('[PrivyLogin] Privy logout error during reset:', e);
          }
          setIsLoggingIn(false);
          toast({
            title: 'Login Error',
            description: 'Could not reset session. Please refresh the page.',
            variant: 'destructive',
          });
          return;
        }
        setIsLoggingIn(false);
        login();
      } else {
        login();
      }
    }, [authenticated, status, login, privyLogout, toast]);

    // Show legacy account modal for new users (once per login session)
    useEffect(() => {
      if (
        session?.user?.needsLegacyLink &&
        status === 'authenticated' &&
        typeof window !== 'undefined' &&
        !sessionStorage.getItem(LEGACY_MODAL_SHOWN_KEY)
      ) {
        setShowLegacyModal(true);
      }
    }, [session?.user?.needsLegacyLink, status]);

    // Fetch pending UGC count for admins
    const fetchPendingUGC = useCallback(async () => {
      if (session?.user?.isAdmin) {
        try {
          const res = await fetch('/api/pendingUGCCount');
          if (res.ok) {
            const data = await res.json();
            setHasPendingUGC(data.count > 0);
          }
        } catch (e) {
          console.error('[PrivyLogin] Error fetching pending UGC count', e);
        }
      } else {
        setHasPendingUGC(false);
      }
    }, [session]);

    // Fetch UGC count for current user
    const fetchUGCCount = useCallback(async () => {
      if (!session) return;

      try {
        const res = await fetch('/api/ugcCount');
        if (res.ok) {
          const data = await res.json();
          setUgcCount(data.count);

          if (typeof window !== 'undefined') {
            const storageKey = `ugcCount_${session.user.id}`;
            const stored = Number(localStorage.getItem(storageKey) || '0');
            setHasNewUGC(data.count > stored);
          }
        }
      } catch (e) {
        console.error('[PrivyLogin] Error fetching UGC count', e);
      }
    }, [session]);

    useEffect(() => {
      fetchUGCCount();
    }, [fetchUGCCount, session]);

    useEffect(() => {
      window.addEventListener('ugcCountUpdated', fetchUGCCount);
      return () => window.removeEventListener('ugcCountUpdated', fetchUGCCount);
    }, [fetchUGCCount]);

    useEffect(() => {
      window.addEventListener('pendingUGCUpdated', fetchPendingUGC);
      fetchPendingUGC();
      const interval = setInterval(fetchPendingUGC, 30000);

      return () => {
        window.removeEventListener('pendingUGCUpdated', fetchPendingUGC);
        clearInterval(interval);
      };
    }, [fetchPendingUGC]);

    const handleLogout = async () => {
      try {
        sessionStorage.removeItem(LEGACY_MODAL_SHOWN_KEY);
        await signOut({ redirect: false });
        await privyLogout();
        window.location.reload();
      } catch (error) {
        console.error('[PrivyLogin] Logout error:', error);
        toast({
          title: 'Error',
          description: 'Failed to log out. Please try again.',
          variant: 'destructive',
        });
      }
    };

    const themeMenuItem = (
      <DropdownMenuItem onSelect={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </DropdownMenuItem>
    );

    // Loading state
    if (!ready || isLoggingIn) {
      return (
        <Button
          className="bg-pastypink animate-pulse w-12 h-12 px-0"
          size="lg"
          type="button"
          disabled
        >
          <img className="max-h-6" src="/spinner.svg" alt="Loading..." />
        </Button>
      );
    }

    // Not authenticated - show login dropdown
    if (status !== 'authenticated' || !session) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={ref}
              id="login-btn"
              size="lg"
              type="button"
              className={`hover:bg-gray-200 transition-colors duration-300 text-white px-0 w-12 h-12 bg-pastypink ${buttonStyles}`}
              onClick={handleLogin}
            >
              <LogIn color="white" size={20} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem asChild>
              <Link href="/leaderboard" prefetch>
                Leaderboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile" prefetch>
                User Profile
              </Link>
            </DropdownMenuItem>
            {themeMenuItem}
            <DropdownMenuItem onSelect={handleLogin}>Log In</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    // Authenticated - show user dropdown
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={ref}
              type="button"
              size="lg"
              className="relative bg-pastypink hover:bg-pastypink/80 transition-colors duration-300 w-12 h-12 p-0 flex items-center justify-center"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden">
                <img
                  src="/default_pfp_pink.png"
                  alt="Profile"
                  className="w-full h-full rounded-full object-cover"
                />
              </div>
              {(hasPendingUGC || hasNewUGC) && (
                <span className="absolute top-0 right-0 h-3 w-3 rounded-full bg-red-600 border-2 border-white" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem asChild>
              <Link href="/leaderboard" prefetch>
                Leaderboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center gap-2" asChild>
              <Link
                href="/profile"
                prefetch
                onClick={() => {
                  try {
                    if (session && typeof window !== 'undefined') {
                      const storageKey = `ugcCount_${session.user.id}`;
                      localStorage.setItem(storageKey, String(ugcCount));
                      setHasNewUGC(false);
                      window.dispatchEvent(new Event('ugcCountUpdated'));
                    }
                  } catch {}
                }}
              >
                <span>User Profile</span>
                {hasNewUGC && (
                  <span className="inline-block h-2 w-2 rounded-full bg-red-600" />
                )}
              </Link>
            </DropdownMenuItem>
            {hasDashboardClaim && claimedArtistId && (
              <DropdownMenuItem asChild>
                <Link href={`/artist/${claimedArtistId}`} prefetch>
                  My Artist Profile
                </Link>
              </DropdownMenuItem>
            )}
            {session?.user?.isAdmin && (
              <DropdownMenuItem asChild className="flex items-center gap-2">
                <Link href="/admin" prefetch>
                  <span>Admin Panel</span>
                  {hasPendingUGC && (
                    <span className="inline-block h-2 w-2 rounded-full bg-red-600" />
                  )}
                </Link>
              </DropdownMenuItem>
            )}
            {session?.user?.needsLegacyLink && (
              <DropdownMenuItem onSelect={() => setShowLegacyModal(true)}>
                Link Wallet
              </DropdownMenuItem>
            )}
            {themeMenuItem}
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                handleLogout();
              }}
            >
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <LegacyAccountModal
          open={showLegacyModal}
          onClose={() => {
            setShowLegacyModal(false);
            sessionStorage.setItem(LEGACY_MODAL_SHOWN_KEY, 'true');
          }}
        />
      </>
    );
  }
);

PrivyLogin.displayName = 'PrivyLogin';

export default PrivyLogin;
