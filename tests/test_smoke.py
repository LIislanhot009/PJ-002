from __future__ import annotations

import os
import unittest
import uuid
from unittest.mock import patch

from backend.deepseek import deepseek_client
from backend.graph import builder_logic, classify_intent, execute_run, make_customer_context
from backend.rag import rag
from backend.storage import memory_store, run_store


class ForgeFlowSmokeTests(unittest.TestCase):
    def test_intent_classification(self) -> None:
        with patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "1"}):
            self.assertEqual(classify_intent("我的订单号是多少，现在物流到哪里了？")[0], "logistics")
            self.assertEqual(classify_intent("这件商品可以退款吗？")[0], "refund")
            self.assertEqual(classify_intent("物流显示签收但我没有收到")[0], "complaint")

    def test_deepseek_intent_path_is_supported_without_network(self) -> None:
        response = '{"intent":"logistics","label":"模型判断：物流查询","confidence":0.91}'
        with (
            patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "0"}),
            patch.object(deepseek_client, "api_key", "test-key"),
            patch.object(deepseek_client, "complete", return_value=response),
        ):
            result = classify_intent("包裹现在到哪里了？")
        self.assertEqual(result[:3], ("logistics", "模型判断：物流查询", 0.91))
        self.assertEqual(result[3], "deepseek")

    def test_deepseek_builder_reply_is_used_and_preserves_controlled_ids(self) -> None:
        run_id = f"test-builder-{uuid.uuid4().hex[:10]}"
        conversation_id = "conversation-builder"
        context = make_customer_context(conversation_id)
        state = {
            "run_id": run_id,
            "prompt": "物流显示签收但我没有收到",
            "project_name": "客服处理工作流",
            "conversation_id": conversation_id,
            "conversation_history": [],
            "turn": 2,
            "intent": "complaint",
            "customer_context": context,
            "retrieved_context": [
                {
                    "id": "cs-demo-003",
                    "title": "物流签收异常处理",
                    "content": "先核对代收点和门卫信息，再登记签收异常。",
                    "compliance": {"status": "合规"},
                }
            ],
            "agent_outputs": {},
            "events": [],
            "metrics": {},
        }
        run_store.create(run_id, state)
        model_reply = (
            f"我已经帮您核对了订单 {context['order_id']}，物流单号是 {context['tracking_id']}。"
            "系统显示包裹已签收，但您没有收到的话，请先核对代收点和门卫信息。"
        )
        with (
            patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "0"}),
            patch.object(deepseek_client, "api_key", "test-key"),
            patch.object(deepseek_client, "complete", return_value=model_reply) as complete,
        ):
            result = builder_logic(state)

        builder = result["agent_outputs"]["builder"]
        self.assertEqual(builder["provider"], "deepseek")
        self.assertEqual(builder["customer_reply"], model_reply)
        self.assertIn(context["order_id"], builder["customer_reply"])
        self.assertIn(context["tracking_id"], builder["customer_reply"])
        complete.assert_called_once()

    def test_deepseek_builder_rejects_reply_without_controlled_ids(self) -> None:
        run_id = f"test-builder-invalid-{uuid.uuid4().hex[:10]}"
        conversation_id = "conversation-builder-invalid"
        context = make_customer_context(conversation_id)
        state = {
            "run_id": run_id,
            "prompt": "我的订单什么时候发货？",
            "project_name": "客服处理工作流",
            "conversation_id": conversation_id,
            "conversation_history": [],
            "turn": 1,
            "intent": "order_status",
            "customer_context": context,
            "retrieved_context": [],
            "agent_outputs": {},
            "events": [],
            "metrics": {},
        }
        run_store.create(run_id, state)
        with (
            patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "0"}),
            patch.object(deepseek_client, "api_key", "test-key"),
            patch.object(deepseek_client, "complete", return_value="您的订单正在处理中，请稍等。"),
        ):
            result = builder_logic(state)

        builder = result["agent_outputs"]["builder"]
        self.assertEqual(builder["provider"], "local-fallback")
        self.assertIn(context["order_id"], builder["customer_reply"])
        self.assertIn(context["tracking_id"], builder["customer_reply"])

    def test_rag_returns_compliant_customer_service_data(self) -> None:
        hits = rag.search("物流显示签收但我没有收到", limit=5)
        ids = {item["id"] for item in hits}
        self.assertIn("cs-demo-003", ids)
        self.assertTrue(all(item["compliance"]["status"] == "合规" for item in hits))

    def test_graph_preserves_ids_and_emits_each_agent(self) -> None:
        run_id = f"test-{uuid.uuid4().hex[:10]}"
        initial = {
            "run_id": run_id,
            "prompt": "我的订单号是多少？现在物流到哪里了？",
            "project_name": "客服处理工作流",
            "conversation_id": "conversation-smoke",
            "conversation_history": [],
            "turn": 1,
            "pinned_context_ids": [],
            "plan": {},
            "retrieved_context": [],
            "agent_outputs": {},
            "metrics": {},
        }
        run_store.create(run_id, initial)

        with (
            patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "1"}),
            patch.object(memory_store, "append_run"),
        ):
            result = execute_run(initial)

        context = result["customer_context"]
        reply = result["final_output"]["customer_reply"]
        self.assertIn(context["order_id"], reply)
        self.assertIn(context["tracking_id"], reply)
        self.assertEqual(result["conversation_id"], "conversation-smoke")
        self.assertEqual(
            {"intent", "research", "builder", "qa", "reflection"},
            {event["agent"] for event in result["events"] if event.get("agent")},
        )
        self.assertEqual(result["status"], "completed")

    def test_customer_context_is_stable(self) -> None:
        self.assertEqual(
            make_customer_context("conversation-stable"),
            make_customer_context("conversation-stable"),
        )


if __name__ == "__main__":
    unittest.main()
