import type { Metadata } from "next";
import "./globals.css";
import Nav from "./_components/nav";
import { Toaster } from "@/components/ui/toaster";
import Footer from "./_components/Footer";
import Head from "next/head";

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
        url: "https://www.musicnerd.xyz/musicNerdLogo.png",
        width: 800, // Standard Open Graph image size
        height: 800,
        alt: "Music Nerd Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@musicnerd.xyz",
    title: "Music Nerd",
    description: "A crowd-sourced directory of music artists",
    images: ["https://www.musicnerd.xyz/musicNerdLogo.png"],
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
  return (
    <html lang="en" className="scrollbar-hide">
      <body className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-grow flex flex-col min-h-0">
          {children}
        </main>
        <Toaster />
        <Footer />
      </body>
    </html>
  );
}
