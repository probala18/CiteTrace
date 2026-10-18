// LLM completion helper with robust JSON parsing, think tag stripping, and retry

function extractJson(raw: string): any {
  let cleaned = raw.trim();

  // Strip DeepSeek/reasoning <think>...</think> tags
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip markdown code fences ```json ... ```
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find outermost JSON object
  const startObj = cleaned.indexOf("{");
  const endObj = cleaned.lastIndexOf("}");
  if (startObj !== -1 && endObj !== -1 && endObj > startObj) {
    cleaned = cleaned.substring(startObj, endObj + 1);
  }

  // Remove trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse LLM response as JSON. Output was: ${raw.slice(0, 160)}...`);
  }
}

export async function jsonCompletion(
  system: string,
  user: string,
  modelOverride?: string,
  apiKeyOverride?: string,
  baseUrlOverride?: string
): Promise<any> {
  const apiKey = apiKeyOverride || process.env.OPENAI_API_KEY;
  const baseUrl = (baseUrlOverride || process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const rawModel = modelOverride || process.env.LLM_MODEL || "openrouter/free";
  // Map retired or defunct models to active ones
  const mappedModel = rawModel === "google/gemini-2.0-flash-exp:free" ? "openrouter/free" : rawModel;

  const candidateModels = Array.from(new Set([
    mappedModel,
    "openrouter/free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-001",
  ]));

  let lastErrorText = "";

  for (const targetModel of candidateModels) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!res.ok) {
        lastErrorText = await res.text();
        // If 404 (endpoint not found) or 429 (rate limit), continue to fallback model
        if (res.status === 404 || res.status === 429 || lastErrorText.includes("No endpoints found")) {
          console.warn(`Model "${targetModel}" returned ${res.status}. Attempting fallback...`);
          continue;
        }
        throw new Error(`LLM provider returned ${res.status}: ${lastErrorText.slice(0, 180)}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0]?.message?.content;
      if (!choice) {
        continue;
      }

      return extractJson(choice);
    } catch (err: any) {
      if (err.message && !err.message.includes("LLM provider returned")) {
        lastErrorText = err.message;
      }
    }
  }

  throw new Error(`LLM call failed for all candidate models (${candidateModels.join(", ")}): ${lastErrorText.slice(0, 180)}`);
}
