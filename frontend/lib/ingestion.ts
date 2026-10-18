import crypto from "crypto";
import mammoth from "mammoth";

export interface ParsedChunk {
  chunk_index: number;
  page_number: number | null;
  heading: string | null;
  text: string;
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function parsePdf(buffer: Buffer): Promise<{ text: string; pageCount: number; pages: { pageNumber: number; text: string }[] }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfModule = require("pdf-parse");

  // Modern pdf-parse v2+ with PDFParse class
  if (pdfModule && pdfModule.PDFParse) {
    const parser = new pdfModule.PDFParse({ data: buffer });
    try {
      const res = await parser.getText();
      const totalText = String(res.text || "");
      const pageCount = Number(res.total || (res.pages ? res.pages.length : 1));
      const pages = (res.pages || [])
        .map((p: any) => ({
          pageNumber: Number(p.num || 1),
          text: String(p.text || "").trim(),
        }))
        .filter((p: any) => p.text.length > 0);

      return {
        text: totalText,
        pageCount: Math.max(pageCount, pages.length || 1),
        pages: pages.length > 0 ? pages : [{ pageNumber: 1, text: totalText.trim() }],
      };
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy().catch(() => {});
      }
    }
  }

  // Classic pdf-parse v1 function
  const fn = typeof pdfModule === "function" ? pdfModule : pdfModule?.default;
  if (typeof fn === "function") {
    const data = await fn(buffer);
    const totalText = String(data.text || "");
    const pageCount = Number(data.numpages || 1);
    const rawPages = totalText.split("\f");
    const pages: { pageNumber: number; text: string }[] = [];

    if (rawPages.length > 1) {
      rawPages.forEach((pageText: string, i: number) => {
        const trimmed = pageText.trim();
        if (trimmed) {
          pages.push({ pageNumber: i + 1, text: trimmed });
        }
      });
    } else {
      pages.push({ pageNumber: 1, text: totalText.trim() });
    }

    return {
      text: totalText,
      pageCount: Math.max(pageCount, pages.length || 1),
      pages: pages.length > 0 ? pages : [{ pageNumber: 1, text: totalText.trim() }],
    };
  }

  throw new Error("Unable to parse PDF: pdf-parse module format not recognized.");
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
