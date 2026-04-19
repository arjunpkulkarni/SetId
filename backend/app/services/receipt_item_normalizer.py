"""Abbreviation / display-name normalization for receipt line items."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from app.core.config import settings

if TYPE_CHECKING:
    from openai import OpenAI

# Extend over time; keys are lowercased stripped names.
_ITEM_NAME_DICTIONARY: dict[str, str] = {
    "chk sndwch": "Chicken Sandwich",
    "chk sand": "Chicken Sandwich",
    "chkn sndwch": "Chicken Sandwich",
    "fries": "French Fries",
    "ff": "French Fries",
}


def _dictionary_normalize(name: str) -> str | None:
    key = " ".join(name.split()).strip().lower()
    return _ITEM_NAME_DICTIONARY.get(key)


def _llm_normalize_name(raw_name: str, client: OpenAI | None) -> str | None:
    if not client or not settings.GROQ_API_KEY:
        return None
    try:
        response = client.chat.completions.create(
            model=settings.GROQ_RECEIPT_CLEANUP_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You expand abbreviated restaurant receipt item names to clear English titles. "
                        "Return strict JSON only: {\"name\": string}. "
                        "If already clear, return it unchanged. Never invent a different dish."
                    ),
                },
                {"role": "user", "content": json.dumps({"name": raw_name})},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "item_name_normalize",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {"name": {"type": "string"}},
                        "required": ["name"],
                        "additionalProperties": False,
                    },
                },
            },
        )
        content = (response.choices[0].message.content or "").strip()
        if not content:
            return None
        data = json.loads(content)
        name = str(data.get("name", "")).strip()
        return name or None
    except Exception:
        return None


def normalize_cleanup_payload(cleaned, llm_client: OpenAI | None = None):
    """Apply dictionary + optional LLM normalization to item names."""
    from app.services.receipt_parser_service import CleanupReceiptPayload

    if not isinstance(cleaned, CleanupReceiptPayload):
        return cleaned

    new_items = []
    for it in cleaned.items:
        name = it.name
        mapped = _dictionary_normalize(name)
        if mapped:
            name = mapped
        else:
            llm_name = _llm_normalize_name(name, llm_client)
            if llm_name:
                name = llm_name
        new_items.append(it.model_copy(update={"name": name}))

    return cleaned.model_copy(update={"items": new_items})
