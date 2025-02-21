import type { Metadata } from "next";
import "./globals.css";
import Nav from "./_components/nav";
import { Toaster } from "@/components/ui/toaster";
import Footer from "./_components/Footer";
import Head from "next/head";

export const metadata: Metadata = {
  title: "Music Nerd",
  description: "A crowd sourced directory of music artists",
};

export default async  function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scrollbar-hide"> 
      <Head>
      <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.musicnerd.xyz" />
        <meta property="og:title" content="Music Nerd" />
        <meta property="og:description" content="A crowd sourced directory of music artists" />
        <meta property="og:image" content="https://www.musicnerd.xyz/musicNerdLogo.png" />
        <meta property="og:image:alt" content="Music Nerd Logo" />

        {/* Twitter Card (X, formerly Twitter) */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Music Nerd" />
        <meta name="twitter:description" content="A crowd sourced directory of music artists" />
        <meta name="twitter:image" content="https://www.musicnerd.xyz/musicNerdLogo.png" />
        <meta name="twitter:image:alt" content="Music Nerd Logo" />
        <meta name="twitter:site" content="@musicnerd.xyz" />

        {/* Favicon (optional but recommended) */}
        <link rel="icon" href="/icon.ico" />
      </Head>
      <body className="min-h-screen flex flex-col">
          <Nav/>
          <main className="flex-grow flex flex-col min-h-0">
            {children}
          </main>
          <Toaster/>
          <Footer/>
      </body>
    </html>
  );
}
