import re
from typing import Any

import numpy as np

from .config import get_settings
from .db import get_chunks
from .embeddings import embed_texts

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
    "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "what", "when", "where",
    "which", "who", "why", "with", "can", "could", "does", "do", "how", "may", "must", "should",
}


def terms(text: str) -> set[str]:
    return {word.lower() for word in re.findall(r"[\w'-]+", text) if len(word) > 1 and word.lower() not in STOPWORDS}


def retrieve(question: str, top_k: int | None = None, document_id: str | None = None) -> list[dict[str, Any]]:
    settings = get_settings()
    chunks = get_chunks()
    if document_id:
        chunks = [c for c in chunks if str(c.get("document_id")) == str(document_id)]
    if not chunks:
        return []
    query_vector = np.asarray(embed_texts([question])[0], dtype=np.float32)
    query_terms = terms(question)
    ranked = []
    for chunk in chunks:
        vector = np.asarray(chunk["embedding"], dtype=np.float32)
        semantic = float(np.dot(query_vector, vector) / (np.linalg.norm(query_vector) * np.linalg.norm(vector) + 1e-9))
        chunk_terms = terms(chunk["text"])
        lexical = len(query_terms & chunk_terms) / max(1, len(query_terms))
        # Blend semantic similarity with transparent keyword overlap. This is an MVP hybrid ranker,
        # not a substitute for BM25 + a learned reranker in the production evaluation phase.
        score = 0.68 * max(0.0, semantic) + 0.32 * lexical
        ranked.append({**chunk, "semantic_score": semantic, "lexical_score": lexical, "retrieval_score": score})
    ranked.sort(key=lambda item: item["retrieval_score"], reverse=True)
    k = top_k or settings.retrieval_top_k
    return [row for row in ranked[:k] if row["retrieval_score"] >= settings.min_relevance_score]
