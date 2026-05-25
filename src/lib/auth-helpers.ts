import { getServerAuthSession } from '@/server/auth';
import type { Session } from '@/server/auth';
import { getUserById } from '@/server/utils/queries/userQueries';
import { getApprovedClaimByUserId } from '@/server/utils/queries/dashboardQueries';

type AuthSuccess = { authenticated: true; session: Session; userId: string };
type AuthFailure = { authenticated: false; response: Response };
type AuthResult = AuthSuccess | AuthFailure;

/**
 * Require an authenticated session. Returns 401 if not authenticated.
 */
export async function requireAuth(): Promise<AuthResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return {
      authenticated: false,
      response: Response.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }
  return { authenticated: true, session, userId: session.user.id };
}

/**
 * Require an admin session. Returns 401 if not authenticated, 403 if not admin.
 */
export async function requireAdmin(): Promise<AuthResult> {
  const authResult = await requireAuth();
  if (!authResult.authenticated) {
    return authResult;
  }

  const dbUser = await getUserById(authResult.userId);
  if (!dbUser?.isAdmin) {
    return {
      authenticated: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return authResult;
}

/**
 * Require the caller to be an admin OR the approved claimant of `artistId`.
 * Returns 401 if not authenticated, 403 if neither admin nor the artist's owner.
 */
export async function requireArtistEditor(artistId: string): Promise<AuthResult> {
  const authResult = await requireAuth();
  if (!authResult.authenticated) return authResult;

  const dbUser = await getUserById(authResult.userId);
  if (dbUser?.isAdmin) return authResult;

  const claim = await getApprovedClaimByUserId(authResult.userId);
  if (claim?.artistId === artistId) return authResult;

  return {
    authenticated: false,
    response: Response.json({ error: 'Forbidden' }, { status: 403 }),
  };
}

/**
 * Require a whitelisted or admin session. Returns 401 if not authenticated, 403 if neither.
 */
export async function requireWhitelistedOrAdmin(): Promise<AuthResult> {
  const authResult = await requireAuth();
  if (!authResult.authenticated) {
    return authResult;
  }

  const dbUser = await getUserById(authResult.userId);
  if (!dbUser?.isAdmin && !dbUser?.isWhiteListed) {
    return {
      authenticated: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return authResult;
}
