import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "./_components/nav";
import { Toaster } from "@/components/ui/toaster";
import Footer from "./_components/Footer";
import Providers from "./_components/Providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Nav />
          <main className="flex-grow flex flex-col min-h-0 w-full">
            {children}
          </main>
          <Toaster />
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
