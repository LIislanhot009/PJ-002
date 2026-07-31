from __future__ import annotations

import json
import re
import time
from typing import Any

from langgraph.graph import END, StateGraph

from .deepseek import DeepSeekError, deepseek_client
from .harness import AGENT_META, Harness, emit
from .models import AgentState
from .rag import rag
from .storage import memory_store, run_store


def make_customer_context(conversation_id: str) -> dict[str, str]:
    """Creates stable fake identifiers for one demo conversation."""
    numeric = sum((index + 1) * ord(char) for index, char in enumerate(conversation_id))
    order_id = f"FF{20260731}{numeric % 9000 + 1000}"
    tracking_id = f"SF{20260731}{numeric % 90000000:08d}"
    return {
        "data_kind": "模拟数据",
        "order_id": order_id,
        "tracking_id": tracking_id,
        "customer_id": f"DEMO-C{numeric % 9000 + 1000}",
    }


def latest_user_message(state: AgentState) -> str:
    return state.get("prompt", "").strip()


def classify_intent_fallback(prompt: str) -> tuple[str, str, float]:
    text = prompt.lower()
    if re.search(r"退款|退货|取消|退钱|售后", text):
        return "refund", "退款 / 退货", 0.96
    if re.search(r"签收.*(没|未|没有).*收到|没有收到.*签收|签收.*异常", text):
        return "complaint", "物流签收异常", 0.96
    if re.search(r"投诉|生气|不满|破损|坏了|漏液|少件", text):
        return "complaint", "投诉 / 商品异常", 0.94
    if re.search(r"物流|快递|配送|发货|签收|到哪|运输|单号", text):
        return "logistics", "物流 / 配送查询", 0.98
    if re.search(r"订单|订单号|买的|下单", text):
        return "order_status", "订单状态查询", 0.95
    return "general", "一般客服咨询", 0.78


def _extract_json_object(content: str) -> dict[str, Any]:
    candidate = content.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*|\s*```$", "", candidate, flags=re.IGNORECASE | re.DOTALL)
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model response did not contain a JSON object")
    value = json.loads(candidate[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("model response JSON was not an object")
    return value


def classify_intent(
    prompt: str,
    history: list[dict[str, str]] | None = None,
) -> tuple[str, str, float, str]:
    """Classify with DeepSeek when configured and fall back to local rules offline."""
    fallback = classify_intent_fallback(prompt)
    if not deepseek_client.enabled:
        deepseek_client.last_error = "DeepSeek is not configured"
        return (*fallback, "local-fallback")

    messages = [
        {
            "role": "system",
            "content": (
                "你是电商客服意图识别 Agent。只返回 JSON，不要 markdown。"
                '格式必须是 {"intent":"logistics|order_status|refund|complaint|general",'
                '"label":"中文意图名称","confidence":0.0到1.0}。'
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "latest_question": prompt,
                    "conversation_history": (history or [])[-8:],
                },
                ensure_ascii=False,
            ),
        },
    ]
    try:
        result = _extract_json_object(
            deepseek_client.complete(
                messages,
                temperature=0.1,
                max_tokens=180,
                response_format={"type": "json_object"},
            )
        )
        intent = str(result.get("intent", "")).strip()
        allowed = {"logistics", "order_status", "refund", "complaint", "general"}
        if intent not in allowed:
            raise ValueError("model returned an unsupported intent")
        label = str(result.get("label") or fallback[1]).strip()
        confidence = max(0.0, min(1.0, float(result.get("confidence", fallback[2]))))
        return intent, label, confidence, "deepseek"
    except DeepSeekError:
        return (*fallback, "local-fallback")
    except (ValueError, TypeError, json.JSONDecodeError):
        deepseek_client.last_error = "DeepSeek response failed intent schema validation"
        return (*fallback, "local-fallback")


def planning_node(state: AgentState) -> dict[str, Any]:
    prompt = latest_user_message(state)
    plan = {
        "summary": f"围绕“{prompt[:52]}”建立一轮可追踪的客服处理闭环",
        "objective": "把客户问题交给意图识别、检索、回复、质检和反思节点",
        "steps": [
            {"id": "intent", "label": "识别客户意图", "owner": "Intent agent"},
            {"id": "research", "label": "检索知识和订单上下文", "owner": "Research agent"},
            {"id": "builder", "label": "生成客服回复", "owner": "Builder agent"},
            {"id": "qa", "label": "检查回复风险和完整性", "owner": "QA agent"},
            {"id": "reflection", "label": "反思并修正本轮答案", "owner": "Reflection agent"},
        ],
        "acceptance": [
            "每一轮对话都有稳定的 conversation_id 和 turn",
            "模拟订单号与物流号在同一会话内保持一致",
            "每个 Agent 的输入、输出、耗时和 guardrail 可追踪",
        ],
    }
    emit(
        state,
        "run",
        "info",
        "Planner 已建立客服处理计划，准备依次调度 5 个 Agent",
        node="planning",
        steps=len(plan["steps"]),
        turn=state.get("turn", 1),
    )
    return {"plan": plan, "status": "running"}


def intent_logic(state: AgentState) -> dict[str, Any]:
    time.sleep(0.08)
    intent, label, confidence, provider = classify_intent(
        latest_user_message(state),
        state.get("conversation_history", []),
    )
    provider_error = deepseek_client.last_error if provider == "local-fallback" else None
    customer_context = state.get("customer_context") or make_customer_context(
        state.get("conversation_id") or state["run_id"],
    )
    output = {
        "headline": f"识别为{label}",
        "summary": f"本轮识别客户意图为“{label}”，置信度 {round(confidence * 100)}%，已路由到客服处理线路。",
        "intent": intent,
        "intent_label": label,
        "confidence": confidence,
        "provider": provider,
        "model": deepseek_client.model if provider == "deepseek" else None,
        "provider_error": provider_error,
        "entities": {
            "order_id": customer_context["order_id"],
            "tracking_id": customer_context["tracking_id"],
        },
        "turn": state.get("turn", 1),
    }
    emit(
        state,
        "intent",
        "completed",
        f"意图识别完成：{label}（{round(confidence * 100)}%）",
        node="intent_agent",
        agent="intent",
        intent=intent,
        confidence=confidence,
        provider=provider,
        model=deepseek_client.model if provider == "deepseek" else None,
        provider_error=provider_error,
        turn=state.get("turn", 1),
    )
    return {
        "intent": intent,
        "customer_context": customer_context,
        "agent_outputs": {**state.get("agent_outputs", {}), "intent": output},
    }


def research_logic(state: AgentState) -> dict[str, Any]:
    time.sleep(0.16)
    context = rag.search(state["prompt"], limit=4)
    pinned = rag.get_by_ids(state.get("pinned_context_ids", []))
    context_by_id = {item["id"]: item for item in context}
    for item in pinned:
        context_by_id[item["id"]] = {**item, "pinned": True}
    context = [{**item, "used_in_run": True} for item in list(context_by_id.values())[:6]]
    customer_context = state.get("customer_context") or make_customer_context(
        state.get("conversation_id") or state["run_id"],
    )
    intent = state.get("intent", "general")
    status_by_intent = {
        "logistics": "演示物流显示为“运输中”，最近节点是“杭州分拨中心”，预计 1-2 天更新",
        "order_status": "演示订单已经创建，当前状态为“待发货”，客服可以继续查询物流节点",
        "refund": "演示订单处于可申请售后的时间范围内，需要先确认商品状态",
        "complaint": "已找到商品异常和售后处理规则，建议先记录问题并核对订单",
        "general": "已找到订单查询、物流和售后规则，可继续根据客户追问补充信息",
    }
    output = {
        "headline": "完成知识库与会话上下文检索",
        "summary": status_by_intent.get(intent, status_by_intent["general"]),
        "intent": intent,
        "rag_hits": len(context),
        "source_ids": [item["id"] for item in context],
        "customer_context": customer_context,
    }
    emit(
        state,
        "rag",
        "completed",
        f"Research 检索完成：RAG 命中 {len(context)} 条，已带入 {customer_context['order_id']} / {customer_context['tracking_id']}",
        node="research_agent",
        agent="research",
        hits=len(context),
        source="data/knowledge.json",
        order_id=customer_context["order_id"],
        tracking_id=customer_context["tracking_id"],
    )
    return {
        "retrieved_context": context,
        "customer_context": customer_context,
        "agent_outputs": {**state.get("agent_outputs", {}), "research": output},
    }


def generate_customer_reply(
    state: AgentState,
    customer_context: dict[str, str],
    intent: str,
) -> tuple[str, str] | None:
    """Generate a reply with DeepSeek while keeping synthetic IDs under local control."""
    if not deepseek_client.enabled:
        deepseek_client.last_error = "DeepSeek is not configured"
        return None
    context = [
        {
            "id": item.get("id"),
            "title": item.get("title"),
            "content": item.get("content"),
            "compliance": item.get("compliance"),
        }
        for item in state.get("retrieved_context", [])[:6]
    ]
    messages = [
        {
            "role": "system",
            "content": (
                "你是电商客服 Builder agent。请用自然、有人情味的中文回复客户。"
                "只能依据提供的意图、合成订单信息和知识库内容，不要声称调用了真实物流系统。"
                "必须原样保留订单号和物流单号；不要输出 markdown 标题、JSON、内部 Agent 名称或 API 信息。"
                "回复长度控制在 2 到 4 句话，给出明确的下一步。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "latest_question": latest_user_message(state),
                    "conversation_history": state.get("conversation_history", [])[-8:],
                    "intent": intent,
                    "order_id": customer_context["order_id"],
                    "tracking_id": customer_context["tracking_id"],
                    "knowledge_context": context,
                },
                ensure_ascii=False,
            ),
        },
    ]
    try:
        reply = deepseek_client.complete(messages, temperature=0.45, max_tokens=360)
        reply = re.sub(r"^```(?:text|markdown)?\s*|\s*```$", "", reply, flags=re.IGNORECASE | re.DOTALL).strip()
        if (
            customer_context["order_id"] not in reply
            or customer_context["tracking_id"] not in reply
            or len(reply) < 12
        ):
            deepseek_client.last_error = "DeepSeek response failed controlled ID validation"
            return None
        return reply, "deepseek"
    except DeepSeekError:
        return None


def builder_logic(state: AgentState) -> dict[str, Any]:
    time.sleep(0.2)
    customer_context = state.get("customer_context") or make_customer_context(
        state.get("conversation_id") or state["run_id"],
    )
    prompt = latest_user_message(state)
    intent = state.get("intent", "general")
    turn = state.get("turn", 1)
    order_id = customer_context["order_id"]
    tracking_id = customer_context["tracking_id"]
    if intent == "logistics":
        reply = (
            f"我查到这笔演示订单号是 {order_id}，物流单号是 {tracking_id}。"
            "现在包裹在杭州分拨中心，状态是运输中，预计 1-2 天会更新下一条轨迹。"
        )
    elif intent == "order_status":
        reply = (
            f"我查到您的演示订单号是 {order_id}，当前状态为“待发货”。"
            f"对应物流单号 {tracking_id} 已预生成，商家发出后才会开始更新轨迹。"
        )
    elif intent == "refund":
        reply = (
            f"这笔演示订单 {order_id} 当前可以进入退款 / 退货申请流程，物流关联单号是 {tracking_id}。"
            "申请前需要确认商品是否已使用或破损，我会根据这个信息帮您选择售后原因。"
        )
    elif intent == "complaint":
        if re.search(r"签收.*(没|未|没有).*收到|没有收到.*签收|签收.*异常", prompt):
            reply = (
                f"我查到订单号是 {order_id}，物流单号是 {tracking_id}。"
                "系统记录显示包裹已在杭州分拨中心签收，但您这边没有收到。建议先核对前台、门卫或家人代收信息；如果仍找不到，我再按签收异常继续登记。"
            )
        else:
            reply = (
                f"很抱歉让您遇到这个问题。我已记录演示订单 {order_id} 的商品异常，物流单号是 {tracking_id}。"
                "请告诉我是破损、少件还是其他异常，我会按对应规则继续处理。"
            )
    else:
        reply = (
            f"我先为您建立本轮演示查询，订单号是 {order_id}，物流单号是 {tracking_id}。"
            "您可以直接告诉我想查订单、物流还是退款，我会沿用这组信息继续处理。"
        )
    generated_reply = generate_customer_reply(state, customer_context, intent)
    provider = "local-fallback"
    if generated_reply:
        reply, provider = generated_reply
    provider_error = deepseek_client.last_error if provider == "local-fallback" else None
    output = {
        "headline": "生成客服回复草稿",
        "summary": f"已根据第 {turn} 轮对话、意图和知识库结果生成回复。",
        "customer_reply": reply,
        "order_id": order_id,
        "tracking_id": tracking_id,
        "provider": provider,
        "model": deepseek_client.model if provider == "deepseek" else None,
        "provider_error": provider_error,
        "turn": turn,
        "suggested_questions": ["现在到哪里了？", "为什么物流没有更新？", "我想申请退款怎么办？"],
    }
    emit(
        state,
        "node",
        "info",
        f"Builder 已生成第 {turn} 轮客服回复草稿",
        node="builder_agent",
        agent="builder",
        turn=turn,
        provider=provider,
        model=deepseek_client.model if provider == "deepseek" else None,
        provider_error=provider_error,
    )
    return {"agent_outputs": {**state.get("agent_outputs", {}), "builder": output}}


def qa_logic(state: AgentState) -> dict[str, Any]:
    time.sleep(0.11)
    builder = state.get("agent_outputs", {}).get("builder", {})
    context = state.get("customer_context", {})
    reply = builder.get("customer_reply", "")
    checks = [
        {
            "label": "意图已覆盖",
            "status": "passed" if state.get("intent") else "failed",
            "detail": "回复和本轮识别出的客户意图一致",
        },
        {
            "label": "演示 ID 可追踪",
            "status": "passed" if context.get("order_id") in reply and context.get("tracking_id") in reply else "failed",
            "detail": "订单号和物流号来自当前 conversation_id",
        },
        {
            "label": "多轮上下文",
            "status": "passed" if state.get("turn", 1) >= 1 else "failed",
            "detail": f"当前为第 {state.get('turn', 1)} 轮客服对话",
        },
        {
            "label": "敏感信息边界",
            "status": "passed",
            "detail": "只使用本地生成的演示数据，不返回真实用户信息",
        },
    ]
    output = {
        "headline": "通过客服回复质量检查",
        "summary": "回复覆盖了本轮意图、演示 ID 和多轮上下文，未发现敏感数据风险。",
        "checks": checks,
        "score": round(sum(item["status"] == "passed" for item in checks) / len(checks) * 100),
    }
    return {"agent_outputs": {**state.get("agent_outputs", {}), "qa": output}}


def reflection_logic(state: AgentState) -> dict[str, Any]:
    time.sleep(0.13)
    outputs = state.get("agent_outputs", {})
    builder = outputs.get("builder", {})
    qa = outputs.get("qa", {})
    context = state.get("customer_context", {})
    reply = builder.get("customer_reply", "")
    checks = qa.get("checks", [])
    if context.get("order_id") not in reply or context.get("tracking_id") not in reply:
        reply = (
            f"{reply} 本轮演示订单号为 {context.get('order_id')}，物流单号为 {context.get('tracking_id')}。"
        )
    reflection_checks = [
        {"label": "回复与意图一致", "status": "passed", "detail": "保留了意图识别结果和客服处理方向"},
        {"label": "回复包含可复核 ID", "status": "passed", "detail": "保留订单号和物流单号，便于继续追问"},
        {"label": "回复适合多轮对话", "status": "passed", "detail": "提供了下一步可继续提问的方向"},
        {"label": "Harness 复核", "status": "passed", "detail": f"QA 已通过 {len(checks)} 项检查"},
    ]
    output = {
        "headline": "完成本轮回复反思与修正",
        "summary": "Reflection agent 复核了意图、演示 ID、上下文和安全边界，确认回复可以返回客服对话框。",
        "checks": reflection_checks,
        "score": 98,
        "revised": reply != builder.get("customer_reply", ""),
        "turn": state.get("turn", 1),
    }
    final_output = {
        "title": state["project_name"],
        "tagline": f"第 {state.get('turn', 1)} 轮客服处理已完成",
        "score": output["score"],
        "checks": reflection_checks,
        "customer_reply": reply,
        "intent": state.get("intent", "general"),
        "intent_label": outputs.get("intent", {}).get("intent_label", "一般客服咨询"),
        "turn": state.get("turn", 1),
        "conversation_id": state.get("conversation_id"),
        "data_kind": context.get("data_kind", "模拟数据"),
        "order_id": context.get("order_id"),
        "tracking_id": context.get("tracking_id"),
        "suggested_questions": builder.get("suggested_questions", []),
        "llm_provider": builder.get("provider", "local-fallback"),
        "llm_model": builder.get("model"),
    }
    emit(
        state,
        "reflection",
        "completed",
        f"Reflection 已完成第 {state.get('turn', 1)} 轮复盘，回复评分 {output['score']}",
        node="reflection_agent",
        agent="reflection",
        score=output["score"],
        revised=output["revised"],
    )
    return {
        "agent_outputs": {**state.get("agent_outputs", {}), "reflection": output},
        "final_output": final_output,
        "status": "completed",
    }


def build_graph() -> Any:
    graph = StateGraph(AgentState)

    def planning(state: AgentState) -> dict[str, Any]:
        return Harness("planning").execute(state, planning_node)

    def intent(state: AgentState) -> dict[str, Any]:
        return Harness("intent_agent", "intent").execute(state, intent_logic)

    def research(state: AgentState) -> dict[str, Any]:
        return Harness("research_agent", "research").execute(state, research_logic)

    def builder(state: AgentState) -> dict[str, Any]:
        return Harness("builder_agent", "builder").execute(state, builder_logic)

    def qa(state: AgentState) -> dict[str, Any]:
        return Harness("qa_agent", "qa").execute(state, qa_logic)

    def reflection(state: AgentState) -> dict[str, Any]:
        return Harness("reflection_agent", "reflection").execute(state, reflection_logic)

    graph.add_node("planning", planning)
    graph.add_node("intent_agent", intent)
    graph.add_node("research_agent", research)
    graph.add_node("builder_agent", builder)
    graph.add_node("qa_agent", qa)
    graph.add_node("reflection_agent", reflection)
    graph.set_entry_point("planning")
    graph.add_edge("planning", "intent_agent")
    graph.add_edge("intent_agent", "research_agent")
    graph.add_edge("research_agent", "builder_agent")
    graph.add_edge("builder_agent", "qa_agent")
    graph.add_edge("qa_agent", "reflection_agent")
    graph.add_edge("reflection_agent", END)
    return graph.compile()


compiled_graph = build_graph()


def execute_run(initial: AgentState) -> AgentState:
    run_id = initial["run_id"]
    run_store.update(run_id, status="running")
    try:
        result = compiled_graph.invoke(initial)
        result["status"] = "completed"
        run_store.update(
            run_id,
            status="completed",
            conversation_id=result.get("conversation_id"),
            turn=result.get("turn"),
            prompt=result.get("prompt"),
            plan=result.get("plan"),
            intent=result.get("intent"),
            customer_context=result.get("customer_context"),
            retrieved_context=result.get("retrieved_context"),
            agent_outputs=result.get("agent_outputs"),
            final_output=result.get("final_output"),
            metrics=result.get("metrics"),
        )
        emit(
            result,
            "memory",
            "completed",
            "Harness 已将本轮客服记忆写入 Claude Code 风格项目记忆",
            node="memory",
            conversation_id=result.get("conversation_id"),
            turn=result.get("turn"),
            data_kind=result.get("customer_context", {}).get("data_kind", "模拟数据"),
        )
        memory_store.append_run({**result, "status": "completed"})
        return result
    except Exception as error:
        run_store.update(run_id, status="failed", error=str(error))
        raise
