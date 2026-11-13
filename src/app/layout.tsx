import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Capture & Create - 3D Print Studio",
  description: "Turn your photos into a 3D-printable model with Capture & Create.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
