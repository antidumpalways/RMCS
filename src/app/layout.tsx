import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'R CELL Management System',
  description: 'Pembukuan digital sederhana untuk konter HP',
  manifest: '/manifest.json',
  applicationName: 'RCMS',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'R CELL',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#16a34a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          <div className="mx-auto min-h-screen max-w-2xl pb-24">
            <main className="px-4 pt-4 sm:px-6">{children}</main>
          </div>
        </Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
