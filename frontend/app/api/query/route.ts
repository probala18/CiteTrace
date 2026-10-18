import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/rag";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, top_k, document_id, mode } = body;

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json(
        { detail: "Question must be at least 3 characters long." },
        { status: 400 }
      );
    }

    const topKNumber = typeof top_k === "number" && top_k >= 1 && top_k <= 12 ? top_k : 6;
    const documentId = typeof document_id === "string" && document_id.trim() ? document_id.trim() : null;
    const answerMode = typeof mode === "string" && mode.trim() ? mode.trim() : "precise";

    const apiKey = req.headers.get("x-openai-api-key") || body.api_key || undefined;
    const baseUrl = req.headers.get("x-openai-base-url") || body.api_base_url || undefined;
    const model = req.headers.get("x-llm-model") || body.llm_model || undefined;

    const result = await answerQuestion(question.trim(), topKNumber, documentId, answerMode, {
      apiKey,
      baseUrl,
      model,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { detail: error.message || "Query processing failed" },
      { status: 500 }
    );
  }
}
