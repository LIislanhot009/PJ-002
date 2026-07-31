from __future__ import annotations

from typing import Any, Literal, TypedDict

from pydantic import BaseModel, Field


AgentId = Literal["intent", "research", "builder", "qa", "reflection"]


class RunRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    project_name: str = Field(default="Untitled product", max_length=120)
    context_ids: list[str] = Field(default_factory=list, max_length=20)
    conversation_id: str = Field(default="", max_length=120)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=30)
    turn: int = Field(default=1, ge=1, le=100)


class RagQuery(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=10)


class AgentState(TypedDict, total=False):
    run_id: str
    prompt: str
    project_name: str
    conversation_id: str
    conversation_history: list[dict[str, str]]
    turn: int
    plan: dict[str, Any]
    retrieved_context: list[dict[str, Any]]
    pinned_context_ids: list[str]
    intent: str
    customer_context: dict[str, str]
    agent_outputs: dict[str, dict[str, Any]]
    events: list[dict[str, Any]]
    metrics: dict[str, Any]
    status: str
    final_output: dict[str, Any]
    error: str


class Event(BaseModel):
    id: int
    run_id: str
    type: Literal["run", "node", "harness", "rag", "intent", "reflection", "memory", "error"]
    status: Literal["queued", "running", "completed", "failed", "info"]
    node: str | None = None
    agent: str | None = None
    message: str
    timestamp: str
    duration_ms: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunResponse(BaseModel):
    run_id: str
    status: str
