// Stub type declarations for deleted packages
// These allow kept components to compile even though packages are uninstalled

declare module 'next-auth/react' {
  export function useSession(...args: any[]): any;
  export function SessionProvider(...args: any[]): any;
  export function signIn(...args: any[]): any;
  export function signOut(...args: any[]): any;
}

declare module 'next-auth' {
  export type Session = any;
}

// pdf-parse v1 ships no types for the lib entry point. We import the lib entry
// directly to avoid the debug harness in the package's index.js (it reads a
// bundled test PDF from disk and throws ENOENT in serverless).
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>;
  export default pdfParse;
}
