import type { Metadata } from "next";
import { Geist_Mono, Manrope, PT_Sans } from "next/font/google";
import "./globals.css";

const brandSans = Manrope({
  variable: "--font-brand-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

const brandHeading = PT_Sans({
  variable: "--font-brand-heading",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Конструктор обучающих курсов",
  description:
    "Внутренний AI-ассистент для подготовки обучающих курсов из видео и документов.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${brandSans.variable} ${brandHeading.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
