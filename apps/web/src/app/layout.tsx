import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
