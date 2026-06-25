import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ZK Perps — Private Perpetuals on Stellar',
  description: 'Zero-knowledge perpetuals trading on Stellar Soroban',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Oswald:wght@600;700&display=swap" rel="stylesheet"/>
      </head>
      <body>{children}</body>
    </html>
  )
}
