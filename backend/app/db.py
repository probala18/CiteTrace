import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import get_settings


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    settings = get_settings()
    conn = sqlite3.connect(str(settings.database_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                file_type TEXT NOT NULL,
                content_sha256 TEXT NOT NULL,
                page_count INTEGER,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                page_number INTEGER,
                heading TEXT,
                text TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
            CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_sha256);
            """
        )


def add_document(doc: dict[str, Any], chunks: list[dict[str, Any]]) -> None:
    with connect() as conn:
        conn.execute(
            """INSERT INTO documents
            (id, filename, stored_path, file_type, content_sha256, page_count, chunk_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (doc["id"], doc["filename"], doc["stored_path"], doc["file_type"], doc["content_sha256"],
             doc.get("page_count"), len(chunks), doc["created_at"]),
        )
        conn.executemany(
            """INSERT INTO chunks
            (id, document_id, chunk_index, page_number, heading, text, embedding_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [(c["id"], c["document_id"], c["chunk_index"], c.get("page_number"), c.get("heading"),
              c["text"], json.dumps(c["embedding"]), c["created_at"]) for c in chunks],
        )


def list_documents() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, filename, file_type, content_sha256, page_count, chunk_count, created_at FROM documents ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def get_document(document_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    return dict(row) if row else None


def delete_document(document_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not row:
            return None
        record = dict(row)
        conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    return record


def get_chunks() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """SELECT c.id, c.document_id, c.chunk_index, c.page_number, c.heading, c.text,
                      c.embedding_json, d.filename
               FROM chunks c JOIN documents d ON d.id = c.document_id"""
        ).fetchall()
    output = []
    for row in rows:
        item = dict(row)
        item["embedding"] = json.loads(item.pop("embedding_json"))
        output.append(item)
    return output
