import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { brand } from "@darna/design-tokens";
import { themeCss } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${brand.name} Operations`, template: `%s · ${brand.name} Operations` },
  description: "Internal staff console",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
