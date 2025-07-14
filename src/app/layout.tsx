import type { Metadata } from "next";
import "./globals.css";
import '@rainbow-me/rainbowkit/styles.css';
import Nav from "./_components/nav";
import { Toaster } from "@/components/ui/toaster";
import Footer from "./_components/Footer";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import Providers from "./_components/Providers";
import LoginProviders from "./_components/nav/components/LoginProviders";

export const metadata: Metadata = {
  title: "Music Nerd",
  description: "A crowd-sourced directory of music artists",
  openGraph: {
    type: "website",
    url: "https://www.musicnerd.xyz",
    title: "Music Nerd",
    description: "A crowd-sourced directory of music artists",
    images: [
      {
        url: "https://www.musicnerd.xyz/icon.ico",
        width: 800,
        height: 800,
        alt: "Music Nerd Icon",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@musicnerd.xyz",
    title: "Music Nerd",
    description: "A crowd-sourced directory of music artists",
    images: ["https://www.musicnerd.xyz/icon.ico"],
  },
  icons: {
    icon: "/icon.ico",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  console.log("Root layout session state:", {
    exists: !!session,
    userId: session?.user?.id
  });

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Providers session={session}>
          <LoginProviders>
            <Nav />
            <main className="flex-grow flex flex-col min-h-0">
              {children}
            </main>
            <Toaster />
            <Footer />
          </LoginProviders>
        </Providers>
      </body>
    </html>
  );
}
