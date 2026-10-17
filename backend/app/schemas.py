from typing import Literal
from pydantic import BaseModel, Field


class DocumentOut(BaseModel):
    id: str
    filename: str
    file_type: str
    content_sha256: str
    page_count: int | None = None
    chunk_count: int
    created_at: str


class Citation(BaseModel):
    evidence_id: str
    document_id: str
    filename: str
    page_number: int | None = None
    heading: str | None = None
    excerpt: str
    retrieval_score: float | None = None


class VerifiedClaim(BaseModel):
    id: str
    claim: str
    status: Literal["supported", "partially_supported", "contradicted", "unverified"]
    explanation: str
    citations: list[Citation] = Field(default_factory=list)


class QueryRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    top_k: int | None = Field(default=None, ge=1, le=12)
    document_id: str | None = Field(default=None, description="Optional document ID to restrict query to a specific document")
    mode: Literal["precise", "executive", "comprehensive", "audit", "timeline"] = Field(
        default="precise", description="Answer mode: precise, executive, comprehensive, audit, or timeline"
    )


class QueryResponse(BaseModel):
    status: Literal["verified", "mixed", "insufficient_evidence", "verification_failed"]
    answer: str
    claims: list[VerifiedClaim] = Field(default_factory=list)
    retrieved_evidence: list[Citation] = Field(default_factory=list)
    warning: str | None = None
    mode: str | None = None
