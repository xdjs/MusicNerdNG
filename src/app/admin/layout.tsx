import type { Metadata } from "next";
import "../globals.css";
import Nav from "../_components/nav";
import Footer from "../_components/Footer";

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
    <html lang="en"> 
      <body className="gradient-background">
          <Nav/>
          {children}
          <Footer/>
      </body>
    </html>
  );
}
