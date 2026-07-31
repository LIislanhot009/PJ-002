from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class DeepSeekError(RuntimeError):
    """Raised when the optional DeepSeek provider cannot return a response."""


class DeepSeekClient:
    """Small dependency-free client for DeepSeek's OpenAI-compatible endpoint."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 20,
    ) -> None:
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY", "").strip()
        self.base_url = (
            base_url
            or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
        )
        self.model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
        self.timeout = timeout
        self.last_error: str | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.api_key) and os.getenv("FORGEFLOW_DISABLE_LLM") != "1"

    def status(self) -> dict[str, Any]:
        return {
            "provider": "deepseek",
            "configured": self.enabled,
            "model": self.model,
            "mode": "deepseek" if self.enabled else "local-fallback",
            "last_error": self.last_error,
        }

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 600,
        response_format: dict[str, str] | None = None,
    ) -> str:
        if not self.enabled:
            self.last_error = "DeepSeek is not configured"
            raise DeepSeekError("DeepSeek is not configured")

        self.last_error = None
        payload = json.dumps(
            {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": False,
                **({"response_format": response_format} if response_format else {}),
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = Request(
            f"{self.base_url}/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            message = f"DeepSeek request failed with HTTP {error.code}"
            self.last_error = message
            raise DeepSeekError(message) from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            message = "DeepSeek request could not be completed"
            self.last_error = message
            raise DeepSeekError(message) from error

        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            message = "DeepSeek returned an invalid completion payload"
            self.last_error = message
            raise DeepSeekError(message) from error
        if not isinstance(content, str) or not content.strip():
            message = "DeepSeek returned an empty completion"
            self.last_error = message
            raise DeepSeekError(message)
        return content.strip()


deepseek_client = DeepSeekClient()
