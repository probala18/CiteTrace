import crypto from "crypto";
import mammoth from "mammoth";
import { extractText } from "unpdf";

export interface ParsedChunk {
  chunk_index: number;
  page_number: number | null;
  heading: string | null;
  text: string;
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function parsePdf(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
  pages: { pageNumber: number; text: string }[];
}> {
  const uint8 = new Uint8Array(buffer);
  const result = await extractText(uint8);
  const pageTexts = result.text || [];
  const totalPages = result.totalPages || pageTexts.length || 1;

  const pages: { pageNumber: number; text: string }[] = [];
  pageTexts.forEach((pText, i) => {
    const trimmed = (pText || "").trim();
    if (trimmed) {
      pages.push({ pageNumber: i + 1, text: trimmed });
    }
  });

  const fullText = pages.map((p) => p.text).join("\n\n");

  return {
    text: fullText,
    pageCount: Math.max(totalPages, pages.length || 1),
    pages: pages.length > 0 ? pages : [{ pageNumber: 1, text: fullText.trim() }],
  };
}

export async function parseDocx(buffer: Buffer): Promise<{ text: string; pageCount: number | null; pages: { pageNumber: number | null; text: string }[] }> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || "";
  return {
    text,
    pageCount: null,
    pages: [{ pageNumber: null, text }],
  };
}

export function chunkText(
  pages: { pageNumber: number | null; text: string }[],
  chunkWords: number = 220,
  overlapWords: number = 40
): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const paragraphs = page.text.split(/\n\s*\n/);
    let currentWords: string[] = [];
    let currentHeading: string | null = null;

    for (const para of paragraphs) {
      const cleanPara = para.trim();
      if (!cleanPara) continue;

      // Simple heuristic for headings (short, capital/title)
      if (cleanPara.length < 90 && !cleanPara.endsWith(".")) {
        currentHeading = cleanPara.replace(/\n/g, " ");
      }

      const words = cleanPara.split(/\s+/);
      currentWords.push(...words);

      while (currentWords.length >= chunkWords) {
        const chunkTextContent = currentWords.slice(0, chunkWords).join(" ").trim();
        if (chunkTextContent.length > 20) {
          chunks.push({
            chunk_index: chunkIndex++,
            page_number: page.pageNumber,
            heading: currentHeading,
            text: chunkTextContent,
          });
        }
        currentWords = currentWords.slice(chunkWords - overlapWords);
      }
    }

    if (currentWords.length > 15) {
      chunks.push({
        chunk_index: chunkIndex++,
        page_number: page.pageNumber,
        heading: currentHeading,
        text: currentWords.join(" ").trim(),
      });
    }
  }

  return chunks;
}
