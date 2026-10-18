import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "EchoAi · Evidence Intelligence | Verified Answers",
  description: "Start by scripting a task, inspect retrieved passages, and verify every factual claim.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
