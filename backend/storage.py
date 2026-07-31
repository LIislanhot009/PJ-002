from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
MEMORY_DIR = ROOT / "memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class RunStore:
    """Small in-memory event store used by the demo's live monitor."""

    def __init__(self) -> None:
        self._runs: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    def create(self, run_id: str, initial: dict[str, Any]) -> None:
        with self._lock:
            self._runs[run_id] = {
                **initial,
                "events": [],
                "status": "queued",
                "created_at": utc_now(),
            }

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            run = self._runs.get(run_id)
            return json.loads(json.dumps(run)) if run else None

    def update(self, run_id: str, **values: Any) -> None:
        with self._lock:
            if run_id in self._runs:
                self._runs[run_id].update(values)

    def add_event(self, run_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            if run_id in self._runs:
                self._runs[run_id]["events"].append(event)

    def events(self, run_id: str, offset: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            run = self._runs.get(run_id)
            return list(run.get("events", [])[offset:]) if run else []

    def snapshot_metrics(self) -> dict[str, Any]:
        with self._lock:
            runs = list(self._runs.values())
            completed = sum(item.get("status") == "completed" for item in runs)
            failed = sum(item.get("status") == "failed" for item in runs)
            all_events = [event for run in runs for event in run.get("events", [])]
            node_events = [event for event in all_events if event.get("type") == "node"]
            durations = [event["duration_ms"] for event in node_events if event.get("duration_ms")]
            return {
                "active_runs": sum(item.get("status") == "running" for item in runs),
                "total_runs": len(runs),
                "completed_runs": completed,
                "failed_runs": failed,
                "events": len(all_events),
                "avg_node_ms": round(sum(durations) / len(durations)) if durations else 0,
                "guardrail_pass_rate": 100 if not failed else round(completed / max(len(runs), 1) * 100),
            }


class ClaudeMemory:
    """Claude Code-inspired append-only memory: MEMORY.md + structured JSONL."""

    def __init__(self, root: Path = MEMORY_DIR) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.memory_md = self.root / "MEMORY.md"
        self.memory_jsonl = self.root / "runs.jsonl"
        if not self.memory_md.exists():
            self.memory_md.write_text(
                "# ForgeFlow project memory\n\n"
                "> Durable context written by the local Agent Harness.\n\n",
                encoding="utf-8",
            )

    def append_run(self, run: dict[str, Any]) -> None:
        record = {
            "timestamp": utc_now(),
            "scope": "forgeflow",
            "run_id": run.get("run_id"),
            "conversation_id": run.get("conversation_id"),
            "turn": run.get("turn", 1),
            "project_name": run.get("project_name"),
            "prompt": run.get("prompt"),
            "intent": run.get("intent"),
            "data_kind": run.get("customer_context", {}).get("data_kind", "模拟数据"),
            "memory_ids": {
                "run_id": run.get("run_id"),
                "conversation_id": run.get("conversation_id"),
                "order_id": run.get("customer_context", {}).get("order_id"),
                "tracking_id": run.get("customer_context", {}).get("tracking_id"),
            },
            "customer_context": run.get("customer_context", {}),
            "plan": run.get("plan"),
            "retrieved_context": run.get("retrieved_context", [])[:3],
            "agent_outputs": run.get("agent_outputs", {}),
            "final_output": run.get("final_output", {}),
            "status": run.get("status"),
        }
        with self.memory_jsonl.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        summary = self._summary(record)
        with self.memory_md.open("a", encoding="utf-8") as handle:
            handle.write(f"\n## {record['timestamp']} · {record['project_name']}\n\n{summary}\n")

    def read_recent(self, limit: int = 8) -> list[dict[str, Any]]:
        if not self.memory_jsonl.exists():
            return []
        rows = self.memory_jsonl.read_text(encoding="utf-8").splitlines()
        return [json.loads(row) for row in rows[-limit:]][::-1]

    @staticmethod
    def _summary(record: dict[str, Any]) -> str:
        outputs = record.get("agent_outputs", {})
        bullets = [
            f"- Status: `{record.get('status', 'unknown')}`",
            f"- Prompt: {record.get('prompt', '')[:220]}",
            f"- Plan: {record.get('plan', {}).get('summary', 'not available')}",
            f"- Memory IDs: conversation `{record.get('conversation_id')}`, run `{record.get('run_id')}`",
            f"- Data: `{record.get('data_kind', '模拟数据')}` / order `{record.get('memory_ids', {}).get('order_id')}` / tracking `{record.get('memory_ids', {}).get('tracking_id')}`",
        ]
        for agent_id, output in outputs.items():
            headline = output.get("headline") or output.get("summary") or "completed"
            bullets.append(f"- {agent_id}: {headline}")
        return "\n".join(bullets)


run_store = RunStore()
memory_store = ClaudeMemory()
