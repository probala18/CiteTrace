import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getDb, initDb } from "@/lib/db";
import { computeSha256, parsePdf, parseDocx, chunkText } from "@/lib/ingestion";
import { embedTexts } from "@/lib/embeddings";

export async function GET() {
  try {
    await initDb();
    const db = getDb();
    const result = await db.execute(`
      SELECT id, filename, file_type, content_sha256, page_count, chunk_count, created_at
      FROM documents
      ORDER BY datetime(created_at) DESC
    `);
    const docs = (result.rows || []).map((r: any) => ({
      id: String(r.id),
      filename: String(r.filename),
      file_type: String(r.file_type),
      content_sha256: String(r.content_sha256),
      page_count: r.page_count ? Number(r.page_count) : null,
      chunk_count: Number(r.chunk_count || 0),
      created_at: String(r.created_at),
    }));
    return NextResponse.json(docs);
  } catch (error: any) {
    return NextResponse.json({ detail: error.message || "Failed to list documents" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const db = getDb();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ detail: "No file provided in form-data" }, { status: 400 });
    }

    const filename = file.name;
    const ext = filename.toLowerCase().split(".").pop();
    if (!["pdf", "docx"].includes(ext || "")) {
      return NextResponse.json({ detail: "Unsupported file type. Only PDF and DOCX files are supported." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sha256 = computeSha256(buffer);

    // Check for duplicate document
    const existing = await db.execute({
      sql: `SELECT id FROM documents WHERE content_sha256 = ?`,
      args: [sha256],
    });
    if (existing.rows && existing.rows.length > 0) {
      return NextResponse.json({ detail: "This document has already been indexed." }, { status: 409 });
    }

    let parsedPages: { pageNumber: number | null; text: string }[] = [];
    let pageCount: number | null = null;

    if (ext === "pdf") {
      const parsed = await parsePdf(buffer);
      parsedPages = parsed.pages;
      pageCount = parsed.pageCount;
    } else {
      const parsed = await parseDocx(buffer);
      parsedPages = parsed.pages;
      pageCount = null;
    }

    const chunks = chunkText(parsedPages, 220, 40);
    if (chunks.length === 0) {
      return NextResponse.json({ detail: "No readable text content found in the document." }, { status: 400 });
    }

    const docId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Generate embeddings for chunks (forwarding optional user API key from headers)
    const apiKey = req.headers.get("x-openai-api-key") || undefined;
    const baseUrl = req.headers.get("x-openai-base-url") || undefined;
    const chunkTexts = chunks.map((c) => c.text);
    const embeddings = await embedTexts(chunkTexts, apiKey, baseUrl);

    // Insert document
    await db.execute({
      sql: `INSERT INTO documents (id, filename, file_type, content_sha256, page_count, chunk_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [docId, filename, ext!, sha256, pageCount, chunks.length, now],
    });

    // Insert chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = crypto.randomUUID();
      const embJson = embeddings[i] ? JSON.stringify(embeddings[i]) : null;

      await db.execute({
        sql: `INSERT INTO chunks (id, document_id, chunk_index, page_number, heading, text, embedding, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [chunkId, docId, chunk.chunk_index, chunk.page_number, chunk.heading, chunk.text, embJson, now],
      });
    }

    return NextResponse.json({
      id: docId,
      filename,
      file_type: ext,
      content_sha256: sha256,
      page_count: pageCount,
      chunk_count: chunks.length,
      created_at: now,
    });
  } catch (error: any) {
    return NextResponse.json({ detail: error.message || "Failed to index document" }, { status: 500 });
  }
}
