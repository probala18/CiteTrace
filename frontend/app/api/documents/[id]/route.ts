import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await initDb();
    const db = getDb();

    // Check if document exists
    const existing = await db.execute({
      sql: `SELECT id, filename FROM documents WHERE id = ?`,
      args: [id],
    });
    if (!existing.rows || existing.rows.length === 0) {
      return NextResponse.json({ detail: "Document not found" }, { status: 404 });
    }

    const filename = String(existing.rows[0].filename);

    // Delete chunks and document
    await db.execute({
      sql: `DELETE FROM chunks WHERE document_id = ?`,
      args: [id],
    });
    await db.execute({
      sql: `DELETE FROM documents WHERE id = ?`,
      args: [id],
    });

    return NextResponse.json({
      status: "deleted",
      document_id: id,
      filename,
    });
  } catch (error: any) {
    return NextResponse.json({ detail: error.message || "Failed to delete document" }, { status: 500 });
  }
}
