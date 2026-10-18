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


def calibrate_score(raw_score: float, exact_phrase: bool = False, heading_match: bool = False) -> float:
    score = raw_score
    if exact_phrase:
        score += 0.12
    if heading_match:
        score += 0.08

    # Calibrate raw semantic/lexical hybrid score to human-interpretable relevance confidence
    if score >= 0.68:
        calibrated = 0.92 + min(0.06, (score - 0.68) * 0.25)
    elif score >= 0.52:
        calibrated = 0.84 + ((score - 0.52) / 0.16) * 0.08
    elif score >= 0.38:
        calibrated = 0.74 + ((score - 0.38) / 0.14) * 0.10
    elif score >= 0.24:
        calibrated = 0.60 + ((score - 0.24) / 0.14) * 0.14
    elif score >= 0.12:
        calibrated = 0.40 + ((score - 0.12) / 0.12) * 0.20
    else:
        calibrated = max(0.10, score * 3.0)

    return float(min(0.99, max(0.10, round(calibrated, 4))))


def retrieve(question: str, top_k: int | None = None, document_id: str | None = None) -> list[dict[str, Any]]:
    settings = get_settings()
    chunks = get_chunks()
    if document_id:
        chunks = [c for c in chunks if str(c.get("document_id")) == str(document_id)]
    if not chunks:
        return []

    clean_question = question.strip().lower()
    query_vector = np.asarray(embed_texts([question])[0], dtype=np.float32)
    query_terms = terms(question)
    query_phrase = " ".join([w for w in re.findall(r"[\w'-]+", clean_question) if w not in STOPWORDS])

    ranked = []
    for chunk in chunks:
        vector = np.asarray(chunk["embedding"], dtype=np.float32)
        norm_q = np.linalg.norm(query_vector)
        norm_v = np.linalg.norm(vector)
        semantic = float(np.dot(query_vector, vector) / (norm_q * norm_v + 1e-9)) if norm_q > 0 and norm_v > 0 else 0.0

        chunk_text_lower = str(chunk.get("text", "")).lower()
        chunk_heading_lower = str(chunk.get("heading", "")).lower()
        chunk_terms = terms(chunk_text_lower)

        lexical = len(query_terms & chunk_terms) / max(1, len(query_terms))
        exact_phrase = (len(query_phrase) > 3 and query_phrase in chunk_text_lower) or (len(clean_question) > 8 and clean_question in chunk_text_lower)
        heading_match = bool(query_terms & terms(chunk_heading_lower))

        raw_score = 0.60 * max(0.0, semantic) + 0.40 * lexical
        calibrated = calibrate_score(raw_score, exact_phrase, heading_match)

        ranked.append({
            **chunk,
            "raw_semantic_score": semantic,
            "raw_lexical_score": lexical,
            "retrieval_score": calibrated,
        })

    ranked.sort(key=lambda item: item["retrieval_score"], reverse=True)
    k = top_k or settings.retrieval_top_k
    return [row for row in ranked[:k] if row["retrieval_score"] >= settings.min_relevance_score]
