import { createAuthenticationAdapter } from '@rainbow-me/rainbowkit';
import { SiweMessage } from 'siwe';
import { getCsrfToken, signIn, signOut } from "next-auth/react"

export const authenticationAdapter = createAuthenticationAdapter({
  getNonce: async () => {
    console.log("[AuthAdapter] Getting CSRF token for nonce");
    // Clear any existing SIWE data to force a new message
    sessionStorage.removeItem('siwe-nonce');
    localStorage.removeItem('siwe.session');
    localStorage.removeItem('wagmi.siwe.message');
    localStorage.removeItem('wagmi.siwe.signature');
    const token = await getCsrfToken() ?? "";
    console.log("[AuthAdapter] Got CSRF token:", token);
    return token;
  },
  createMessage: ({ nonce, address, chainId }) => {
    console.log("[AuthAdapter] Creating SIWE message:", { nonce, address, chainId });
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in with Ethereum to MusicNerd.',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce,
      // Add these fields to make the message more secure
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 1000 * 60 * 5).toISOString(), // 5 minutes from now
    });
    console.log("[AuthAdapter] Created message:", message);
    return message;
  },
  getMessageBody: ({ message }: { message: SiweMessage }) => {
    const messageBody = message.prepareMessage();
    console.log("[AuthAdapter] Prepared message body:", messageBody);
    return messageBody;
  },
  verify: async ({ message, signature }) => {
    try {
      console.log("[AuthAdapter] Starting verification with:", {
        message: JSON.stringify(message),
        signature
      });

      // Clear any existing SIWE data
      sessionStorage.removeItem('siwe-nonce');
      localStorage.removeItem('siwe.session');
      localStorage.removeItem('wagmi.siwe.message');
      localStorage.removeItem('wagmi.siwe.signature');

      // First attempt to sign in
      const response = await signIn("credentials", {
        message: JSON.stringify(message),
        signature,
        redirect: false,
        callbackUrl: window.location.origin,
      });

      console.log("[AuthAdapter] Sign in response:", response);

      if (response?.error) {
        console.error("[AuthAdapter] Sign in failed:", response.error);
        return false;
      }

      // Wait a moment for the session to be established
      await new Promise(resolve => setTimeout(resolve, 2000));

      return true;
    } catch (error) {
      console.error("[AuthAdapter] Error during verification:", error);
      return false;
    }
  },
  signOut: async () => {
    try {
      console.log("[AuthAdapter] Signing out");
      
      // Clear CSRF token cookie first
      document.cookie = 'next-auth.csrf-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';
      
      // Clear all session data
      sessionStorage.clear();
      localStorage.removeItem('siwe.session');
      localStorage.removeItem('wagmi.siwe.message');
      localStorage.removeItem('wagmi.siwe.signature');
      sessionStorage.removeItem('siwe-nonce');
      
      // Clear all wagmi-related data
      localStorage.removeItem('wagmi.wallet');
      localStorage.removeItem('wagmi.connected');
      localStorage.removeItem('wagmi.injected.connected');
      localStorage.removeItem('wagmi.store');
      localStorage.removeItem('wagmi.cache');
      
      await signOut({ 
        redirect: false,
        callbackUrl: window.location.origin
      });
      
      // Wait longer for session cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Force a page reload to clear any lingering state
      window.location.reload();
      
      console.log("[AuthAdapter] Sign out completed");
    } catch (error) {
      console.error("[AuthAdapter] Error during sign out:", error);
    }
  },
});