import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { RegisterSw } from "@/components/shell/RegisterSw";
import { ToastProvider } from "@/components/ui/Toast";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

// Monocraft, SIL OFL 1.1; the licence sits beside the file in public/fonts.
const monocraft = localFont({
  src: "../../public/fonts/Monocraft.ttf",
  variable: "--font-monocraft",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Gotcha",
  description: "A pocket Cobblemon to look after.",
  applicationName: "Gotcha",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Gotcha",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} ${monocraft.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
        <RegisterSw />
      </body>
    </html>
  );
}
