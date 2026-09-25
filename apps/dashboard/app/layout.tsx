import type { ReactNode } from 'react';

export const metadata = { title: 'School Wellbeing Signals' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
