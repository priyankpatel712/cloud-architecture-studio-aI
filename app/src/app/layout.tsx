import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cloud Architecture Studio',
  description: 'AI-assisted cloud architecture diagramming and management',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (Grammarly et al.) stamp
          attributes onto <body> before React hydrates — one level deep only,
          real mismatches in children still surface. */}
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
