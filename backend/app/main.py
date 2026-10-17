import hashlib
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import add_document, delete_document, get_document, init_db, list_documents, utc_now
from .ingestion import ALLOWED_EXTENSIONS, extract_pages, make_chunks, sha256_bytes
from .llm import LLMConfigurationError, LLMOutputError
from .rag import answer_question
from .schemas import DocumentOut, QueryRequest, QueryResponse

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0", description="Evidence-grounded document RAG with claim verification.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name, "version": "0.1.0"}


@app.get("/api/documents", response_model=list[DocumentOut])
def documents() -> list[dict]:
    return list_documents()


@app.post("/api/documents", response_model=DocumentOut, status_code=201)
async def upload_document(file: UploadFile = File(...)) -> dict:
    filename = Path(file.filename or "upload").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported file type. Upload a PDF or DOCX file.")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_mb} MB upload limit.")

    digest = sha256_bytes(content)
    # Avoid accidentally indexing the exact same file repeatedly in this local MVP.
    from .db import connect
    with connect() as conn:
        existing = conn.execute("SELECT id, filename FROM documents WHERE content_sha256 = ?", (digest,)).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"This file is already indexed as '{existing['filename']}'.")

    document_id = str(uuid.uuid4())
    stored_path = settings.upload_dir / f"{document_id}{suffix}"
    try:
        stored_path.write_bytes(content)
        pages = extract_pages(stored_path, suffix)
        if not pages:
            raise HTTPException(status_code=422, detail="No text was extracted. If this is a scanned PDF, OCR support is needed before indexing it.")
        chunks = make_chunks(pages, document_id)
        if not chunks:
            raise HTTPException(status_code=422, detail="No usable text chunks could be created from this file.")
        record = {
            "id": document_id,
            "filename": filename,
            "stored_path": str(stored_path),
            "file_type": suffix.lstrip("."),
            "content_sha256": digest,
            "page_count": max((p["page_number"] or 0 for p in pages), default=0) or None,
            "created_at": utc_now(),
        }
        add_document(record, chunks)
        return {key: record.get(key) for key in ("id", "filename", "file_type", "content_sha256", "page_count", "created_at")} | {"chunk_count": len(chunks)}
    except HTTPException:
        stored_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Document indexing failed: {type(exc).__name__}. Check backend logs.") from exc


@app.delete("/api/documents/{document_id}")
def remove_document(document_id: str) -> dict[str, str]:
    record = delete_document(document_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found.")
    Path(record["stored_path"]).unlink(missing_ok=True)
    return {"status": "deleted", "document_id": document_id}


@app.post("/api/query", response_model=QueryResponse)
def query_documents(request: QueryRequest) -> dict:
    if not list_documents():
        return {
            "status": "insufficient_evidence",
            "answer": "Upload and index a document before asking a question.",
            "claims": [], "retrieved_evidence": [], "warning": "No documents are indexed yet.",
        }
    try:
        return answer_question(request.question, request.top_k, request.document_id, request.mode)
    except LLMConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LLMOutputError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        # Avoid leaking provider responses, keys, or document content in client errors.
        raise HTTPException(status_code=502, detail=f"The RAG pipeline failed ({type(exc).__name__}). Check backend logs and provider settings.") from exc
