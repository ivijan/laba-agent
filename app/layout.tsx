import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "M\u00f3j chatbot", description: "Chatbot LABA" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pl"><body>{children}</body></html>;
}