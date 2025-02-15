import type { Metadata } from "next";
import "./globals.css";
import Nav from "./_components/nav";
import { Toaster } from "@/components/ui/toaster";
import Footer from "./_components/Footer";

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
