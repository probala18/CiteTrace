from functools import lru_cache
from typing import Sequence

from .config import get_settings


@lru_cache(maxsize=1)
def get_model():
    # Defer the heavy ML import and model loading until the first embedding request.
    from sentence_transformers import SentenceTransformer

    settings = get_settings()
    return SentenceTransformer(settings.embedding_model, device="cpu")


def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    if not texts:
        return []
    vectors = get_model().encode(list(texts), normalize_embeddings=True, show_progress_bar=False)
    return vectors.tolist()
