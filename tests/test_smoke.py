from __future__ import annotations

import unittest
import uuid
from unittest.mock import patch

from backend.graph import classify_intent, execute_run, make_customer_context
from backend.rag import rag
from backend.storage import memory_store, run_store


class ForgeFlowSmokeTests(unittest.TestCase):
    def test_intent_classification(self) -> None:
        self.assertEqual(classify_intent("我的订单号是多少，现在物流到哪里了？")[0], "logistics")
        self.assertEqual(classify_intent("这件商品可以退款吗？")[0], "refund")
        self.assertEqual(classify_intent("物流显示签收但我没有收到")[0], "complaint")

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

        with patch.object(memory_store, "append_run"):
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
