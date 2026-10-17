# Evidence Intelligence — RAG + Claim Verification MVP

A starter full-stack project for evidence-grounded document Q&A. It ingests PDF/DOCX text, preserves PDF page references, indexes page-aware chunks with a local embedding model, retrieves passages using semantic similarity + keyword overlap, asks an OpenAI-compatible LLM to produce atomic claims, and verifies each claim against retrieved passages.

> **Prototype notice:** This is a development MVP, not a production legal tool. Verification labels are model assessments and can be wrong. Do not upload confidential client files or rely on outputs for legal decisions until privacy controls, access control, independent evaluations, security review, and human review are implemented.

## What works in this starter

- PDF and DOCX upload (20 MB default cap)
- PDF page tracking and DOCX heading metadata
- Text chunking with overlap
- Local embeddings using `sentence-transformers/all-MiniLM-L6-v2`
- SQLite persistence for document metadata, chunks, and embeddings
- Hybrid MVP retrieval: 68% semantic similarity + 32% keyword overlap
- Claim generation as structured JSON
- Separate claim verifier with `supported`, `partially_supported`, `contradicted`, and `unverified` labels
- Citation IDs checked against the actual retrieved chunk IDs (the LLM cannot make arbitrary IDs into citations)
- Next.js interface for upload, questions, claims, citations, retrieved passages, and deletion
- API-compatible configuration for hosted providers or local Ollama

## Architecture

```text
Next.js UI (localhost:3000)
        │ REST / JSON
        ▼
FastAPI (localhost:8000)
        ├── Upload & parse: PyMuPDF / python-docx
        ├── Chunk & embed: Sentence Transformers
        ├── Store: SQLite (local MVP)
        ├── Retrieve: semantic + keyword overlap
        ├── Claim generation: OpenAI-compatible LLM
        └── Verification: separate LLM call + citation ID validation
```

## Requirements

- Python 3.11 or 3.12 recommended
- Node.js 20.9+ recommended for Next.js 15
- An OpenAI-compatible chat API key and model, or a running Ollama model with its OpenAI-compatible API enabled
- Internet access on first launch to download the sentence-transformer model unless it is already cached

## 1. Configure the backend

Open a terminal in `evidence-intelligence/backend`.

### Windows PowerShell

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set these required values:

```dotenv
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=your_api_key_here
LLM_MODEL=your_provider_model_id
```

Use the exact model ID supported by your provider. Keep the API key private; never put it in the Next.js frontend or commit `.env` to Git.

### Local Ollama alternative

If Ollama is installed and its local API is available, pull/run a model supported by your machine, then configure the OpenAI-compatible endpoint. For example:

```dotenv
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
LLM_MODEL=your_installed_ollama_model_tag
```

Use the exact tag shown by `ollama list`. An LLM response API-compatible with OpenAI Chat Completions is expected. Local generation quality and speed depend on the model and hardware.

### Start the backend

Still inside `backend/` with the virtual environment active:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` to inspect the API, or `http://127.0.0.1:8000/api/health` to check the service. On first upload, the embedding model is downloaded and loaded; allow extra startup time.

## 2. Start the frontend

Open a **second terminal** in `evidence-intelligence/frontend`:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

If the backend runs on another host/port, update `NEXT_PUBLIC_API_URL` in `frontend/.env.local`. Restart the Next dev server after changing this value.

## 3. Test the workflow

1. Upload a text-based PDF or DOCX document.
2. Wait for the “Indexed … into N evidence chunks” message.
3. Ask a question whose answer appears in the document.
4. Inspect each claim, its verification status, and citation excerpts.
5. Ask a question unrelated to the uploaded material. The system should abstain when retrieval returns no sufficiently relevant evidence, although threshold calibration is part of evaluation.
6. Try a question that tempts the model to add an unsupported detail. Inspect whether the verifier marks the unsupported part as partial or unverified.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/documents` | List indexed documents |
| POST | `/api/documents` | Upload and index a PDF or DOCX (`multipart/form-data`, field `file`) |
| DELETE | `/api/documents/{document_id}` | Remove document and indexed chunks |
| POST | `/api/query` | Retrieve evidence, generate claims, and verify them |

Example query body:

```json
{
  "question": "What notice period does the agreement require?",
  "top_k": 6
}
```

## Implementation notes and limitations

- The current lexical portion of hybrid retrieval is a simple overlap score, **not BM25**. Replace it with PostgreSQL full-text/BM25-style search and pgvector after establishing a benchmark.
- SQLite is suitable for a local starter, not a multi-user production deployment.
- OCR is not yet wired in. A scanned PDF with no extractable text is rejected with an explanatory error.
- DOCX pages are not stable in `python-docx`; page numbers are intentionally not fabricated. Heading metadata is used instead.
- Chunk embeddings are stored as JSON in SQLite. A managed vector index or PostgreSQL/pgvector is a later scale-out step.
- The current ingestion endpoint processes the file in the request. Production needs background jobs, size/rate limits at the proxy, malware scanning, robust parsing sandboxing, and job status tracking.
- Authentication, tenancy, document-level ACLs, audit retention controls, encryption/key management, backups, observability, and data retention policies are not implemented.
- The semantic verifier is an LLM judge, not a mathematical proof. Evaluate it against expert-labelled examples; consider NLI classifiers and independent human review for higher-risk use cases.
- A retrieval score is a ranking heuristic, **not** a probability that a claim is true.
- Retrieved text is treated as untrusted content in prompts to reduce prompt-injection risk, but this is not a complete security boundary.

## Next engineering milestones

1. Add a labelled evaluation set and automated tests for Recall@k, citation precision, claim-support precision/recall, abstention, and contradiction detection.
2. Add reranking and compare against the current retrieval baseline.
3. Move to PostgreSQL + pgvector and a proper full-text index; add migrations.
4. Add OCR and a page-rendered document viewer with cited-page navigation.
5. Add background ingestion, auth, per-document authorization, request limits, structured logs, tracing, and secret management.
6. Add versioning and change comparison, then a document contradiction workflow.

## Troubleshooting

- **Backend URL / CORS:** verify the API is running at `http://localhost:8000` and `CORS_ORIGINS=http://localhost:3000`.
- **Embedding model download:** the initial load needs model access. Retry with internet enabled; later runs should use the local cache.
- **Provider/model error:** check `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `LLM_MODEL`. Use your provider's exact model name and compatible endpoint.
- **No text found:** the PDF may be scanned. OCR support is a later milestone; test first with a text-based PDF.
- **Low retrieval relevance:** ask a more specific question and inspect retrieved passages. Tune `MIN_RELEVANCE_SCORE` using a labelled dataset rather than guessing in production.
