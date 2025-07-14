import NextAuth from "next-auth";
import { authOptions } from "@/server/auth";

const handler = NextAuth(authOptions);

// Add better error handling for the route handlers
const wrappedHandler = async (req: Request, context: any) => {
  try {
    console.debug("[NextAuth] Processing request:", {
      method: req.method,
      url: req.url
    });
    
    const response = await handler(req, context);
    
    console.debug("[NextAuth] Response status:", response.status);
    
    return response;
  } catch (error) {
    console.error("[NextAuth] Error processing request:", error);
    throw error;
  }
};

export { wrappedHandler as GET, wrappedHandler as POST };

