import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import Header from "@/components/header";
import ScrollToTop from "@/components/scroll-to-top";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "A.C.E.S. 3D Print Studio",
  description: "For the space between ideas and inventions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetBrainsMono.variable}`}>
        <Script id="scroll-restoration" strategy="beforeInteractive">
          {`history.scrollRestoration = "manual";
            const acesResetScroll = () => {
              window.scrollTo(0, 0);
              requestAnimationFrame(() => window.scrollTo(0, 0));
              setTimeout(() => window.scrollTo(0, 0), 100);
            };
            acesResetScroll();
            addEventListener("pageshow", acesResetScroll);
            addEventListener("popstate", acesResetScroll);
            addEventListener("load", acesResetScroll);`}
        </Script>
        <ScrollToTop />
        <Header />
        {children}
      </body>
    </html>
  );
}
