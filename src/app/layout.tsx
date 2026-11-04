import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import { PwaPrompt } from "@/components/pwa/pwa-prompt";
import { ConfirmProvider } from "@/components/ui/confirm";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "D4DX ERP", template: "%s · D4DX ERP" },
  description: "D4DX Innovations LLP — people, time, projects, sales and finance in one place.",
  applicationName: "D4DX ERP",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  // iPhone / iPad: open from the home screen full screen, like the installed app on Android and desktop.
  appleWebApp: { capable: true, title: "D4DX ERP", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0A1450",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${montserrat.variable} h-full antialiased`}>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before hydration. */}
      <body className="min-h-full bg-ground text-ink" suppressHydrationWarning>
        <ConfirmProvider>
          {children}
          <PwaPrompt />
        </ConfirmProvider>
        <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-inter)" } }} />
      </body>
    </html>
  );
}
