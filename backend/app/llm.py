import json
import logging
import re
from typing import Any

from .config import get_settings

logger = logging.getLogger(__name__)


class LLMConfigurationError(RuntimeError):
    pass


class LLMOutputError(RuntimeError):
    pass


def get_client():
    from openai import OpenAI

    settings = get_settings()
    if not settings.llm_model.strip():
        raise LLMConfigurationError("Set LLM_MODEL in backend/.env before asking questions.")
    if not settings.openai_api_key.strip():
        raise LLMConfigurationError("Set OPENAI_API_KEY in backend/.env, or set it to 'ollama' when using a local Ollama OpenAI-compatible endpoint.")
    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        timeout=settings.llm_timeout_seconds,
        max_retries=2,
    )
    return client, settings.llm_model.strip()


def _clean_json_string(raw: str) -> str:
    """Strip commentary, think tags, markdown fences, and trailing commas."""
    text = raw.strip()
    # Strip <think>...</think> tags commonly returned by reasoning models (e.g. DeepSeek R1 on OpenRouter)
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    
    # Extract content inside ```json ... ``` or ``` ... ``` if present
    code_block_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if code_block_match:
        text = code_block_match.group(1).strip()
    else:
        # Otherwise find outermost braces
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]

    # Remove trailing commas before closing braces or brackets (e.g. {"a": 1, })
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return text


def _extract_fallback_structure(content: str, system: str) -> dict[str, Any]:
    """If strict JSON parsing fails, extract meaningful structured data based on prompt expectation."""
    clean_text = re.sub(r"<think>[\s\S]*?</think>", "", content, flags=re.IGNORECASE).strip()
    clean_text = re.sub(r"```(?:json)?|```", "", clean_text).strip()

    # If this was claim generation
    if "claims" in system.lower():
        claims = []
        lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
        for idx, line in enumerate(lines, start=1):
            # Clean leading numbering like "1. ", "- ", "* "
            statement = re.sub(r"^(\d+[\.\)]|\-|\*)\s*", "", line).strip()
            if len(statement) > 10 and not statement.startswith("{") and not statement.startswith("}"):
                # Find any evidence IDs like E1, chunk_... or UUIDs
                evidence_ids = re.findall(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", statement, flags=re.IGNORECASE)
                claims.append({
                    "id": f"C{idx}",
                    "claim": statement,
                    "evidence_ids": evidence_ids
                })
        return {"claims": claims}

    # If this was claim verification
    if "verifier" in system.lower() or "status" in system.lower():
        text_lower = clean_text.lower()
        if "contradict" in text_lower:
            status = "contradicted"
        elif "partially" in text_lower:
            status = "partially_supported"
        elif "support" in text_lower:
            status = "supported"
        else:
            status = "unverified"
        return {
            "status": status,
            "explanation": clean_text[:300] if clean_text else "Evaluated against retrieved passages.",
            "supporting_evidence_ids": [],
            "contradicting_evidence_ids": []
        }

    return {"answer": clean_text}


def _parse_json(content: str, system: str = "") -> dict[str, Any]:
    cleaned = _clean_json_string(content)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Try extracting with regex for nested json
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start >= 0 and end > start:
        snippet = cleaned[start:end + 1]
        snippet = re.sub(r",\s*([}\]])", r"\1", snippet)
        try:
            parsed = json.loads(snippet)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    # Fallback to intelligent extraction rather than crashing with unhandled error
    logger.warning("Model output was not strict JSON; using fallback parser: %s", content[:200])
    return _extract_fallback_structure(content, system)


def json_completion(system: str, user: str) -> dict[str, Any]:
    client, model = get_client()
    messages = [
        {"role": "system", "content": system + "\n\nCRITICAL: Respond ONLY with a valid JSON object. Do not include markdown preamble or conversational explanations outside the JSON."},
        {"role": "user", "content": user}
    ]

    # Try with response_format first
    try:
        response = client.chat.completions.create(
            model=model,
            temperature=0,
            messages=messages,
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content or ""
        return _parse_json(content, system)
    except Exception as exc:
        # If the provider/model does not support response_format (e.g. some OpenRouter free models), retry without it
        err_msg = str(exc).lower()
        if "response_format" in err_msg or "json_object" in err_msg or "schema" in err_msg or "400" in err_msg:
            logger.info("Provider does not support response_format; retrying without it.")
            response = client.chat.completions.create(
                model=model,
                temperature=0,
                messages=messages,
            )
            content = response.choices[0].message.content or ""
            return _parse_json(content, system)
        raise
