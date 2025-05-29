import {
  getServerSession,
  type DefaultSession,
  type NextAuthOptions,
} from "next-auth";
import { cookies } from 'next/headers';
import { NEXTAUTH_URL } from "@/env";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiweMessage } from "siwe";
import { getUserByWallet, createUser } from "@/server/utils/queriesTS";

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
        },
      }
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
          console.log("[Auth] Starting authorization with credentials:", credentials);
          
          const siwe = new SiweMessage(JSON.parse(credentials?.message || "{}"));
          const authUrl = new URL(NEXTAUTH_URL);
          
          console.log("[Auth] Verifying SIWE message:", {
            address: siwe.address,
            domain: authUrl.host,
            nonce: cookies().get('next-auth.csrf-token')?.value.split('|')[0]
          });

          const result = await siwe.verify({
            signature: credentials?.signature || "",
            domain: authUrl.host,
            nonce: cookies().get('next-auth.csrf-token')?.value.split('|')[0],
          });

          console.log("[Auth] SIWE verification result:", result);

          if (!result.success) {
            console.error("[Auth] SIWE verification failed:", result);
            return null;
          }

          let user = await getUserByWallet(siwe.address);
          if (!user) {
            console.log("[Auth] Creating new user for wallet:", siwe.address);
            user = await createUser(siwe.address);
          }

          console.log("[Auth] Returning user:", user);
          
          // Map the database user to the NextAuth user format
          return {
            id: user.id,
            walletAddress: user.wallet, // Map wallet to walletAddress
            email: user.email,
            name: user.username,
            username: user.username,
            isSignupComplete: true,
          };
        } catch (e) {
          console.error("[Auth] Error during authorization:", e);
          return null;
        }
      },
    }),
  ],
  debug: true, // Enable debug mode to see more detailed logs
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = () => getServerSession(authOptions);
