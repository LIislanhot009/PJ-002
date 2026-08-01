from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .deepseek import deepseek_client
from .graph import AGENT_META, WORKFLOW_ROUTE, execute_run
from .models import RagQuery, RunRequest, RunResponse
from .rag import rag
from .storage import memory_store, run_store, utc_now


app = FastAPI(title="ForgeFlow Agent Harness", version="0.1.0")
configured_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")
configured_origins = [origin.strip() for origin in configured_origins if origin.strip()]
allow_all_origins = "*" in configured_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else configured_origins,
    allow_credentials=not allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks: dict[str, asyncio.Task[Any]] = {}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "forgeflow-agent-harness",
        "langgraph": True,
        "agents": list(AGENT_META.values()),
        "llm": deepseek_client.status(),
        "timestamp": utc_now(),
    }


@app.post("/api/runs", response_model=RunResponse)
async def create_run(request: RunRequest) -> RunResponse:
    run_id = uuid.uuid4().hex[:12]
    conversation_id = request.conversation_id or f"conversation-{run_id}"
    initial = {
        "run_id": run_id,
        "prompt": request.prompt,
        "project_name": request.project_name,
        "conversation_id": conversation_id,
        "conversation_history": request.history,
        "turn": request.turn,
        "pinned_context_ids": request.context_ids,
        "plan": {},
        "retrieved_context": [],
        "agent_outputs": {},
        "metrics": {},
    }
    run_store.create(run_id, initial)
    run_store.add_event(
        run_id,
        {
            "id": 1,
            "run_id": run_id,
            "type": "run",
            "status": "queued",
            "node": None,
            "agent": None,
            "message": "运行已排队，等待 Harness 分配执行线路",
            "timestamp": utc_now(),
            "duration_ms": None,
            "metadata": {},
        },
    )
    task = asyncio.create_task(asyncio.to_thread(execute_run, initial))
    tasks[run_id] = task
    task.add_done_callback(lambda _: tasks.pop(run_id, None))
    return RunResponse(run_id=run_id, status="queued")


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    run = run_store.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return run


async def event_stream(run_id: str) -> AsyncIterator[str]:
    offset = 0
    while True:
        run = run_store.get(run_id)
        if not run:
            yield f"data: {json.dumps({'error': 'run not found'})}\n\n"
            return
        events = run.get("events", [])
        while offset < len(events):
            event = events[offset]
            offset += 1
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        if run.get("status") in {"completed", "failed"} and offset >= len(events):
            yield f"event: done\ndata: {json.dumps({'status': run['status']})}\n\n"
            return
        await asyncio.sleep(0.12)


@app.get("/api/runs/{run_id}/events")
async def stream_run_events(run_id: str) -> StreamingResponse:
    if not run_store.get(run_id):
        raise HTTPException(status_code=404, detail="run not found")
    return StreamingResponse(
        event_stream(run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/api/metrics")
async def metrics() -> dict[str, Any]:
    return {
        **run_store.snapshot_metrics(),
        "agents": [
            {
                "id": meta["id"],
                "label": meta["label"],
                "role": meta["role"],
                "description": meta["description"],
                "flow_role": meta["flow_role"],
                "skills": meta["skills"],
                "color": meta["color"],
            }
            for meta in AGENT_META.values()
        ],
        "workflow": WORKFLOW_ROUTE,
    }


@app.post("/api/rag/search")
async def search_rag(request: RagQuery) -> dict[str, Any]:
    hits = rag.search(request.query, request.limit)
    return {"query": request.query, "hits": hits, "total": len(hits)}


@app.get("/api/memory")
async def memory(response: Response, limit: int = Query(default=8, ge=1, le=20)) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    return {
        "format": "Claude Code inspired MEMORY.md + runs.jsonl",
        "file": "memory/MEMORY.md",
        "runs": memory_store.read_recent(limit),
    }


# The production container serves the built React app from the same origin.
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
