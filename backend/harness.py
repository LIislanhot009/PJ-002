from __future__ import annotations

import time
from typing import Any, Callable

from .models import AgentState
from .storage import run_store, utc_now


AGENT_META = {
    "intent_agent": {
        "id": "intent",
        "label": "Intent agent",
        "short": "意图识别 Agent",
        "role": "识别客户意图并路由处理",
        "description": "从客户自然语言中识别业务意图，并决定后续处理方向。",
        "flow_role": "识别客户意图",
        "skills": ["问题分类", "路由判断"],
        "color": "blue",
    },
    "research_agent": {
        "id": "research",
        "label": "Research agent",
        "short": "知识检索 Agent",
        "role": "检索知识库和订单上下文",
        "description": "检索合规知识片段，并把同一会话的演示订单上下文带入本轮。",
        "flow_role": "检索知识与订单上下文",
        "skills": ["知识库检索", "来源合规审计"],
        "color": "teal",
    },
    "builder_agent": {
        "id": "builder",
        "label": "Builder agent",
        "short": "回复生成 Agent",
        "role": "组织客服回复和下一步动作",
        "description": "根据意图、检索事实和对话历史生成可以直接发给客户的回复。",
        "flow_role": "组织回复与下一步",
        "skills": ["自然语言回复", "订单上下文拼接"],
        "color": "violet",
    },
    "qa_agent": {
        "id": "qa",
        "label": "QA agent",
        "short": "质量检查 Agent",
        "role": "检查回复质量和风险边界",
        "description": "检查回复是否覆盖意图、保留可复核 ID，并遵守演示数据边界。",
        "flow_role": "检查回复质量",
        "skills": ["回复风险检查", "ID 一致性校验"],
        "color": "yellow",
    },
    "reflection_agent": {
        "id": "reflection",
        "label": "Reflection agent",
        "short": "反思 Agent",
        "role": "复盘本轮结果并修正回复",
        "description": "综合 QA 结果复盘本轮回答，必要时修正后再交付给客服。",
        "flow_role": "反思并修正回复",
        "skills": ["多轮复盘", "回复修正"],
        "color": "coral",
    },
}

WORKFLOW_ROUTE = [
    {
        "id": "planning",
        "node": "planning",
        "label": "Planning",
        "role": "拆解问题与验收目标",
        "type": "planner",
        "color": "planning",
    },
    *[
        {
            "id": meta["id"],
            "node": node,
            "label": meta["label"].replace(" agent", ""),
            "role": meta["flow_role"],
            "type": "agent",
            "agent": meta["id"],
            "color": meta["color"],
        }
        for node, meta in AGENT_META.items()
    ],
    {
        "id": "memory",
        "node": "memory",
        "label": "Memory",
        "role": "持久化本轮项目上下文",
        "type": "memory",
        "color": "memory",
    },
]


def emit(state: AgentState, event_type: str, status: str, message: str, **metadata: Any) -> None:
    event = {
        "id": len(state.get("events", [])) + 1,
        "run_id": state["run_id"],
        "type": event_type,
        "status": status,
        "node": metadata.pop("node", None),
        "agent": metadata.pop("agent", None),
        "message": message,
        "timestamp": utc_now(),
        "duration_ms": metadata.pop("duration_ms", None),
        "metadata": metadata,
    }
    state.setdefault("events", []).append(event)
    run_store.add_event(state["run_id"], event)


def _input_summary(state: AgentState) -> dict[str, Any]:
    return {
        "prompt": state.get("prompt", "")[:240],
        "conversation_id": state.get("conversation_id"),
        "turn": state.get("turn", 1),
        "intent": state.get("intent"),
        "retrieved_context_count": len(state.get("retrieved_context", [])),
        "available_output_agents": sorted(state.get("agent_outputs", {}).keys()),
    }


def _output_summary(result: dict[str, Any], agent: str | None) -> dict[str, Any]:
    output = result.get("agent_outputs", {}).get(agent or "", {})
    if output:
        summary: dict[str, Any] = {
            "headline": output.get("headline"),
            "summary": output.get("summary"),
        }
        for key in ("intent", "confidence", "rag_hits", "score", "revised", "provider"):
            if key in output:
                summary[key] = output[key]
        return summary
    if result.get("plan"):
        return {
            "headline": "Plan created",
            "summary": result["plan"].get("summary"),
            "step_count": len(result["plan"].get("steps", [])),
        }
    if result.get("status") == "completed":
        return {"headline": "Memory persisted", "summary": "Run context appended to project memory."}
    return {"output_keys": sorted(result.keys())}


class Harness:
    """Supervises each LangGraph node with timing, guardrails and durable events."""

    def __init__(self, node: str, agent: str | None = None) -> None:
        self.node = node
        self.agent = agent

    def execute(
        self,
        state: AgentState,
        fn: Callable[[AgentState], dict[str, Any]],
    ) -> dict[str, Any]:
        started = time.perf_counter()
        label = AGENT_META.get(self.agent or "", {}).get("label", self.node)
        execution_id = f"{state['run_id']}:{self.node}:turn-{state.get('turn', 1)}"
        emit(
            state,
            "node",
            "running",
            f"Harness 已接管 {label} 的执行线路",
            node=self.node,
            agent=self.agent,
            execution_id=execution_id,
            input_summary=_input_summary(state),
        )
        try:
            result = fn(state)
            duration_ms = round((time.perf_counter() - started) * 1000)
            merged: AgentState = {**state, **result}
            metrics = {**state.get("metrics", {}), **result.get("metrics", {})}
            metrics[self.node] = {
                "duration_ms": duration_ms,
                "guardrail": "passed",
                "output_keys": list(result.keys()),
                "execution_id": execution_id,
            }
            merged["metrics"] = metrics
            emit(
                merged,
                "node",
                "completed",
                f"{label} 已完成，Harness 校验通过",
                node=self.node,
                agent=self.agent,
                duration_ms=duration_ms,
                guardrail="passed",
                execution_id=execution_id,
                input_summary=_input_summary(state),
                output_summary=_output_summary(result, self.agent),
            )
            result["events"] = merged.get("events", [])
            result["metrics"] = metrics
            run_store.update(
                state["run_id"],
                status="running",
                conversation_id=merged.get("conversation_id"),
                turn=merged.get("turn"),
                prompt=merged.get("prompt"),
                plan=merged.get("plan"),
                intent=merged.get("intent"),
                customer_context=merged.get("customer_context"),
                retrieved_context=merged.get("retrieved_context"),
                agent_outputs=merged.get("agent_outputs"),
                final_output=merged.get("final_output"),
                metrics=metrics,
            )
            return result
        except Exception as error:
            duration_ms = round((time.perf_counter() - started) * 1000)
            emit(
                state,
                "error",
                "failed",
                f"{label} 执行失败：{error}",
                node=self.node,
                agent=self.agent,
                duration_ms=duration_ms,
                guardrail="blocked",
            )
            raise
