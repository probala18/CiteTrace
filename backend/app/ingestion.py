import hashlib
import re
import uuid
from pathlib import Path
from typing import Any

import fitz
from docx import Document as DocxDocument

from .config import get_settings
from .db import utc_now
from .embeddings import embed_texts

ALLOWED_EXTENSIONS = {".pdf", ".docx"}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_pages(path: Path, suffix: str) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    if suffix == ".pdf":
        with fitz.open(path) as pdf:
            for i, page in enumerate(pdf):
                text = page.get_text("text").strip()
                if text:
                    pages.append({"page_number": i + 1, "text": text, "heading": None})
    elif suffix == ".docx":
        doc = DocxDocument(path)
        current_heading: str | None = None
        paragraphs: list[str] = []
        for paragraph in doc.paragraphs:
            text = paragraph.text.strip()
            if not text:
                continue
            if paragraph.style and paragraph.style.name.lower().startswith("heading"):
                if paragraphs:
                    pages.append({"page_number": None, "text": "\n".join(paragraphs), "heading": current_heading})
                    paragraphs = []
                current_heading = text
            paragraphs.append(text)
        if paragraphs:
            pages.append({"page_number": None, "text": "\n".join(paragraphs), "heading": current_heading})
        # DOCX does not expose stable PDF-like page numbers through python-docx.
    return pages


def make_chunks(pages: list[dict[str, Any]], document_id: str) -> list[dict[str, Any]]:
    settings = get_settings()
    chunk_size = max(80, settings.chunk_words)
    overlap = min(max(0, settings.chunk_overlap_words), chunk_size // 2)
    step = chunk_size - overlap
    raw: list[dict[str, Any]] = []
    for page in pages:
        words = re.findall(r"\S+", page["text"])
        if not words:
            continue
        for start in range(0, len(words), step):
            piece = " ".join(words[start:start + chunk_size]).strip()
            if not piece:
                continue
            raw.append({
                "id": str(uuid.uuid4()),
                "document_id": document_id,
                "chunk_index": len(raw),
                "page_number": page.get("page_number"),
                "heading": page.get("heading"),
                "text": piece,
                "created_at": utc_now(),
            })
            if start + chunk_size >= len(words):
                break
    embeddings = embed_texts([item["text"] for item in raw]) if raw else []
    for item, vector in zip(raw, embeddings):
        item["embedding"] = vector
    return raw
