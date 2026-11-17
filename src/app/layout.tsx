import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import Header from "@/components/header";
import ScrollToTop from "@/components/scroll-to-top";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

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
  applicationName: "A.C.E.S. 3D Print Studio",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/192-icon.png", sizes: "192x192", type: "image/png" },
      { url: "/512-icon.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/180-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "A.C.E.S.",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B0D12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body
        className={`${plusJakartaSans.variable} ${inter.variable} ${jetBrainsMono.variable}`}
      >
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
