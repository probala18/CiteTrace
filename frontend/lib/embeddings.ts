// Embeddings generator with OpenAI/OpenRouter API and deterministic fallback

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Fallback deterministic pseudo-embedding based on word hashing & character n-grams (384 dimensions)
function localFallbackEmbedding(text: string, dim: number = 384): number[] {
  const vec = new Float64Array(dim);
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  
  for (const word of words) {
    let hash = 5381;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) + hash) + word.charCodeAt(i);
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1;

    // Sub-word bigrams
    for (let i = 0; i < word.length - 1; i++) {
      const subHash = word.charCodeAt(i) * 31 + word.charCodeAt(i + 1);
      const subIdx = Math.abs(subHash) % dim;
      vec[subIdx] += 0.5;
    }
  }

  // Normalize vector to unit length
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      vec[i] /= norm;
    }
  }

  return Array.from(vec);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";

  if (apiKey && apiKey.length > 5) {
    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: model,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.data)) {
          return data.data.map((item: { embedding: number[] }) => item.embedding);
        }
      }
    } catch {
      // Fallback seamlessly to local embedding generator
    }
  }

  // Graceful deterministic fallback
  return texts.map((t) => localFallbackEmbedding(t));
}

export async function embedQuery(query: string): Promise<number[]> {
  const [emb] = await embedTexts([query]);
  return emb || localFallbackEmbedding(query);
}
