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

      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    walletAddress: string;
    email?: string;
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
  secret: "UypDBlYFq7qsYPq7zjjvHldYwEbeUFFG80yEW1IodRw=",
  callbacks: {
    signIn() {
      return true;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub,
        },
      }
    },
  },
  session: {
    strategy: "jwt",
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
          const siwe = new SiweMessage(JSON.parse(credentials?.message || "{}"));
            const authUrl = new URL(NEXTAUTH_URL);
            const result = await siwe.verify({
              signature: credentials?.signature || "",
              domain: authUrl.host,
              nonce: cookies().get('next-auth.csrf-token')?.value.split('|')[0],
            })
            let user = await getUserByWallet(siwe.address);
            if (!user) user = await createUser(siwe.address);
  
            if (result.success) {
              return {
                id: user.id,
                walletAddress: siwe.address,
              }
            }
            return null
        } catch (e) {
          console.log(e)
          return null
        }
      },
    }),
  ],
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = () => getServerSession(authOptions);
