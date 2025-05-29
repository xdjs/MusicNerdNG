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
      statement: 'Sign in with Ethereum to MusicNerd.',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce,
    });
  },
  getMessageBody: ({ message }: { message: SiweMessage }) => {
    return message.prepareMessage();
  },
  verify: async ({ message, signature }) => {
    try {
      console.log("[AuthAdapter] Starting verification with:", {
        message: JSON.stringify(message),
        signature
      });

      // First attempt to sign in
      const response = await signIn("credentials", {
        message: JSON.stringify(message),
        signature,
        redirect: false,
      });

      console.log("[AuthAdapter] Sign in response:", response);

      if (response?.error) {
        console.error("[AuthAdapter] Sign in failed:", response.error);
        return false;
      }

      // Wait a moment for the session to be established
      await new Promise(resolve => setTimeout(resolve, 1000));

      return true;
    } catch (error) {
      console.error("[AuthAdapter] Error during verification:", error);
      return false;
    }
  },
  signOut: async () => {
    try {
      await signOut({ 
        redirect: false,
        callbackUrl: '/' 
      });
    } catch (error) {
      console.error("[AuthAdapter] Error during sign out:", error);
    }
  },
});