import { createAuthenticationAdapter } from '@rainbow-me/rainbowkit';
import { SiweMessage } from 'siwe';
import { getCsrfToken, signIn, signOut } from "next-auth/react"

export const authenticationAdapter = createAuthenticationAdapter({
  getNonce: async () => {
    const token = await getCsrfToken() ?? "";
    return token;
  },
  createMessage: ({ nonce, address, chainId }) => {
    return new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in with Ethereum to the app.',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce,
    });
  },
  getMessageBody: ({ message }) => {
    return message.prepareMessage();
  },
  verify: async ({ message, signature }) => {
    try {
      // Get the return URL from sessionStorage if it exists
      const pendingArtist = sessionStorage.getItem('pendingArtistAdd');
      const callbackUrl = window.location.origin + (pendingArtist ? '' : '/signup');
      
      console.log("[AuthAdapter] Signing in with callback URL:", callbackUrl);
      
      await signIn("credentials", {
        message: JSON.stringify(message),
        signature,
        redirect: false, // Don't redirect automatically
      });
      
      return true;
    } catch (error) {
      console.error("[AuthAdapter] Error during verification:", error);
      return false;
    }
  },
  signOut: async () => {
    await signOut({ callbackUrl: '/', redirect: true });
  },
});