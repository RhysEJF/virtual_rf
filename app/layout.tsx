import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '@virtual_rf',
  description: 'Your personal AI workforce management system',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg-primary text-text-primary antialiased">
        <div className="flex min-h-screen flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
