"""Load super-admin prompts from LiveKit job metadata (JSON string)."""

from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass(frozen=True)
class SessionPrompts:
    system: str
    greeting: str


def load_session_prompts(
    metadata: str | None,
    *,
    default_system: str,
    default_greeting: str,
) -> SessionPrompts:
    """Parse ctx.job.metadata; fall back to file defaults when missing or invalid."""
    if not metadata or not metadata.strip():
        return SessionPrompts(default_system, default_greeting)

    try:
        payload = json.loads(metadata)
    except json.JSONDecodeError:
        return SessionPrompts(default_system, default_greeting)

    system = (payload.get("systemPrompt") or "").strip()
    greeting = (payload.get("greetingPrompt") or "").strip()

    if not system or not greeting:
        return SessionPrompts(default_system, default_greeting)

    return SessionPrompts(system, greeting)
