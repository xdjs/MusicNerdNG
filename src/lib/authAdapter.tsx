import { createAuthenticationAdapter } from '@rainbow-me/rainbowkit';
import { SiweMessage } from 'siwe';
import { getCsrfToken, signIn, signOut } from "next-auth/react"

export const authenticationAdapter = createAuthenticationAdapter({
  getNonce: async () => {
    console.log("[AuthAdapter] Getting CSRF token for nonce");
    // Clear any existing nonce to force a new message prompt
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
      resources: ['https://musicnerd.xyz/*'] // Add resources to make the message more specific
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

      // Clear any existing nonce and session data
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
      // Clear all session data
      sessionStorage.clear();
      localStorage.removeItem('siwe.session');
      localStorage.removeItem('wagmi.siwe.message');
      localStorage.removeItem('wagmi.siwe.signature');
      sessionStorage.removeItem('siwe-nonce');
      
      await signOut({ 
        redirect: false,
        callbackUrl: window.location.origin
      });
      
      // Wait for session cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Force a page reload to clear any lingering state
      window.location.reload();
      
      console.log("[AuthAdapter] Sign out completed");
    } catch (error) {
      console.error("[AuthAdapter] Error during sign out:", error);
    }
  },
});