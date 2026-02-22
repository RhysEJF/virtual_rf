import 'fumadocs-ui/style.css';
import './globals.css';
import { RootProvider } from 'fumadocs-ui/provider';
import { Source_Sans_3, Fraunces, IBM_Plex_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

const body = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
});

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: {
    template: '%s | Flow Docs',
    default: 'Flow Documentation',
  },
  description: 'Documentation for Flow — AI workforce management system',
};

export default function RootLayout({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <html
      lang="en"
      className={`${body.variable} ${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
