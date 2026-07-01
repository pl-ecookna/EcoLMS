import { Inter } from "next/font/google"
import type { Metadata } from "next"

import { DeploymentVersionGuard } from "@/components/deployment-version-guard"

import "./globals.css"

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: "EcoLMS",
  description:
    "Внутренний AI-ассистент для подготовки обучающих курсов из видео и документов.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <main className="flex-1">{children}</main>
        <DeploymentVersionGuard />
      </body>
    </html>
  )
}
