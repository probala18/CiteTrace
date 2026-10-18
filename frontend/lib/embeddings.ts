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

const EMBED_STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "cannot", "could", "did", "do", "does", "doing", "down", "during", "each", "few",
  "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "him",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "let", "me", "more", "most",
  "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
  "our", "ours", "out", "over", "own", "same", "she", "should", "so", "some", "such", "than",
  "that", "the", "their", "theirs", "them", "then", "there", "these", "they", "this", "those",
  "through", "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when",
  "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your", "yours"
]);

// Fallback deterministic pseudo-embedding with stopword filtering & sub-word n-grams (384 dimensions)
function localFallbackEmbedding(text: string, dim: number = 384): number[] {
  const vec = new Float64Array(dim);
  const rawWords = text.toLowerCase().match(/\b\w+\b/g) || [];
  const words = rawWords.filter((w) => w.length > 1 && !EMBED_STOPWORDS.has(w));
  const tokens = words.length > 0 ? words : rawWords;

  for (const word of tokens) {
    let hash = 5381;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) + hash) + word.charCodeAt(i);
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1.5;

    // Sub-word character trigrams for stemming & morphological tolerance
    for (let i = 0; i < word.length - 2; i++) {
      const subHash = word.charCodeAt(i) * 961 + word.charCodeAt(i + 1) * 31 + word.charCodeAt(i + 2);
      const subIdx = Math.abs(subHash) % dim;
      vec[subIdx] += 0.6;
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

export async function embedTexts(
  texts: string[],
  apiKeyOverride?: string,
  baseUrlOverride?: string
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = (apiKeyOverride && apiKeyOverride.trim()) || process.env.OPENAI_API_KEY;
  const baseUrl = (baseUrlOverride || process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
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

export async function embedQuery(
  query: string,
  apiKeyOverride?: string,
  baseUrlOverride?: string
): Promise<number[]> {
  const [emb] = await embedTexts([query], apiKeyOverride, baseUrlOverride);
  return emb || localFallbackEmbedding(query);
}
