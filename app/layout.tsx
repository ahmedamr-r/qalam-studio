import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// Chrome type: Inter Variable (wght + opsz, so 510/590 are real weights) and Geist Mono for token
// names and hex. The static "Inter" faces in globals.css stay for CanvasKit and content previews.
const inter = Inter({ subsets: ["latin"], axes: ["opsz"], variable: "--font-inter", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

// Runs before first paint so a light-theme user never sees a dark flash (and vice versa).
// Keep the keys in sync with src/ui/theme.ts (THEME_KEY) and src/ui/motion.ts (MOTION_KEY).
const THEME_BOOT = `try{var k="qalam.theme",m=localStorage.getItem(k)||"dark",r=m==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):m==="light"?"light":"dark";var h=document.documentElement;h.dataset.theme=r;h.style.colorScheme=r;var mo=localStorage.getItem("qalam.motion");if(mo==="reduced"||mo==="full")h.dataset.motion=mo}catch(e){}`;

export const metadata: Metadata = {
  title: "Qalam Studio",
  description: "An open-source, Arabic-first AI design studio for design tokens, RTL and accessibility.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
