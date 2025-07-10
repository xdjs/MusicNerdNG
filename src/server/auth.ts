import {
  getServerSession,
  type DefaultSession,
  type NextAuthOptions,
} from "next-auth";
import { cookies } from 'next/headers';
import { NEXTAUTH_URL } from "@/env";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiweMessage } from "siwe";
import { getUserByWallet, createUser } from "@/server/utils/queries/userQueries";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      walletAddress?: string;
      isWhiteListed?: boolean;
      isAdmin?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    walletAddress: string;
    email?: string;
    username?: string;
    location?: string;
    businessName?: string;
    image?: string;
    name?: string;
    isSignupComplete: boolean;
    isWhiteListed?: boolean;
    isAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    walletAddress?: string;
    isWhiteListed?: boolean;
    isAdmin?: boolean;
  }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Copy all user properties to the token
        token.walletAddress = user.walletAddress;
        token.email = user.email;
        token.name = user.name || user.username;
        token.isWhiteListed = user.isWhiteListed;
        token.isAdmin = user.isAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub,
          walletAddress: token.walletAddress,
          email: token.email,
          name: token.name,
          isWhiteListed: token.isWhiteListed,
          isAdmin: token.isAdmin,
        },
      }
    },
    async redirect({ url, baseUrl }) {
      // Allow relative URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allow URLs from same origin
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
  pages: {
    signIn: '/',
    error: '/',
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    CredentialsProvider({
      name: "Ethereum",
      credentials: {
        message: {
          label: "Message",
          type: "text",
          placeholder: "0x0",
        },
        signature: {
          label: "Signature",
          type: "text",
          placeholder: "0x0",
        },
      },
      async authorize(credentials): Promise<any> {
        try {
          console.debug("[Auth] Starting authorization");
          
          // Check if wallet requirement is disabled
          if (process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true') {
            // Create or get a temporary user without wallet, but make them whitelisted
            const tempUserId = 'temp-' + Math.random().toString(36).substring(2);
            return {
              id: tempUserId,
              walletAddress: null,
              email: null,
              name: 'Guest User',
              username: 'guest',
              isSignupComplete: true,
              isWhiteListed: true, // Make temporary user whitelisted
              isAdmin: false,
            };
          }

          const siwe = new SiweMessage(JSON.parse(credentials?.message || "{}"));
          const authUrl = new URL(NEXTAUTH_URL);
          
          console.debug("[Auth] Verifying SIWE message", {
            address: siwe.address,
            domain: siwe.domain,
            expectedDomain: authUrl.hostname
          });

          // Normalize domains by removing port numbers if present
          const normalizedMessageDomain = siwe.domain.split(':')[0];
          const normalizedAuthDomain = authUrl.hostname.split(':')[0];

          const result = await siwe.verify({
            signature: credentials?.signature || "",
            domain: normalizedMessageDomain,
            nonce: cookies().get('next-auth.csrf-token')?.value.split('|')[0],
          });

          console.debug("[Auth] SIWE verification result", {
            success: result.success,
            error: result.error,
            normalizedMessageDomain,
            normalizedAuthDomain
          });

          if (!result.success) {
            console.error("[Auth] SIWE verification failed:", {
              error: result.error,
              messageDomain: siwe.domain,
              expectedDomain: authUrl.hostname
            });
            return null;
          }

          let user = await getUserByWallet(siwe.address);
          if (!user) {
            console.debug("[Auth] Creating new user for wallet");
            user = await createUser(siwe.address);
          }

          console.debug("[Auth] Returning user", { id: user.id });
          
          // Map the database user to the NextAuth user format
          return {
            id: user.id,
            walletAddress: user.wallet, // Map wallet to walletAddress
            email: user.email,
            name: user.username,
            username: user.username,
            isSignupComplete: true,
            isWhiteListed: user.isWhiteListed, // Include whitelist status from database
            isAdmin: user.isAdmin,
          };
        } catch (e) {
          console.error("[Auth] Error during authorization:", e);
          return null;
        }
      },
    }),
  ],
  // Enable debug mode only in development
  debug: process.env.NODE_ENV === "development",
  // Add CSRF protection
  secret: process.env.NEXTAUTH_SECRET,
  // Add secure cookies in production
  cookies: {
    sessionToken: {
      name: `${process.env.NODE_ENV === 'production' ? '__Secure-' : ''}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    csrfToken: {
      name: 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = () => getServerSession(authOptions);
