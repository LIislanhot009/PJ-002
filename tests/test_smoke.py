from __future__ import annotations

import os
import time
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.deepseek import deepseek_client
from backend.graph import builder_logic, classify_intent, execute_run, make_customer_context
from backend.main import app
from backend.rag import rag
from backend.storage import memory_store, run_store


class ForgeFlowSmokeTests(unittest.TestCase):
    def test_api_runs_full_workflow(self) -> None:
        with patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "1"}), TestClient(app) as client:
            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["status"], "ok")

            created = client.post(
                "/api/runs",
                json={
                    "prompt": "我的订单号是多少，现在物流到哪里了？",
                    "project_name": "客服处理工作流",
                    "conversation_id": "conversation-api-test",
                    "history": [],
                    "turn": 1,
                    "context_ids": [],
                },
            )
            self.assertEqual(created.status_code, 200)
            run_id = created.json()["run_id"]

            run = {}
            for _ in range(40):
                response = client.get(f"/api/runs/{run_id}")
                self.assertEqual(response.status_code, 200)
                run = response.json()
                if run["status"] in {"completed", "failed"}:
                    break
                time.sleep(0.05)

            self.assertEqual(run["status"], "completed")
            self.assertEqual(run["intent"], "logistics")
            self.assertGreaterEqual(len(run["retrieved_context"]), 1)
            self.assertIn(run["customer_context"]["order_id"], run["final_output"]["customer_reply"])
            self.assertIn(run["customer_context"]["tracking_id"], run["final_output"]["customer_reply"])
            completed_nodes = {
                event["node"]
                for event in run["events"]
                if event["type"] == "node" and event["status"] == "completed"
            }
            self.assertEqual(
                {
                    "planning",
                    "intent_agent",
                    "research_agent",
                    "builder_agent",
                    "qa_agent",
                    "reflection_agent",
                    "memory",
                },
                completed_nodes,
            )

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

    def test_offline_builder_uses_retrieved_facts(self) -> None:
        run_id = f"test-grounded-{uuid.uuid4().hex[:10]}"
        context = make_customer_context("conversation-grounded")
        state = {
            "run_id": run_id,
            "prompt": "我的订单号是多少，现在物流到哪里了？",
            "project_name": "客服处理工作流",
            "conversation_id": "conversation-grounded",
            "conversation_history": [],
            "turn": 1,
            "intent": "logistics",
            "customer_context": context,
            "retrieved_context": rag.search("我的订单号是多少，现在物流到哪里了？", limit=4),
            "agent_outputs": {"intent": {"intent_label": "物流 / 配送查询"}},
            "events": [],
            "metrics": {},
        }
        run_store.create(run_id, state)
        with patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "1"}):
            result = builder_logic(state)

        reply = result["agent_outputs"]["builder"]["customer_reply"]
        self.assertIn("运输中", reply)
        self.assertIn("杭州分拨中心", reply)
        self.assertIn("1-2 天", reply)
        self.assertNotIn("现在包裹在杭州分拨中心，状态是运输中", reply)

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

        memory_write_statuses: list[str] = []

        def capture_memory_write(_: dict) -> None:
            stored_run = run_store.get(run_id)
            memory_write_statuses.append(stored_run["status"])

        with (
            patch.dict(os.environ, {"FORGEFLOW_DISABLE_LLM": "1"}),
            patch.object(memory_store, "append_run", side_effect=capture_memory_write),
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
        self.assertEqual(memory_write_statuses, ["running"])
        self.assertEqual(run_store.get(run_id)["status"], "completed")
        self.assertIn("memory", {event["node"] for event in result["events"]})
        self.assertTrue(any(event["type"] == "memory" and event["status"] == "completed" for event in result["events"]))
        completed_node_events = [
            event
            for event in result["events"]
            if event["type"] == "node" and event["status"] == "completed"
        ]
        self.assertTrue(completed_node_events)
        self.assertTrue(all(event["metadata"].get("execution_id") for event in completed_node_events))
        self.assertTrue(all(event["metadata"].get("output_summary") for event in completed_node_events))
        running_node_events = [
            event
            for event in result["events"]
            if event["type"] == "node" and event["status"] == "running"
        ]
        self.assertTrue(running_node_events)
        self.assertTrue(all(event["metadata"].get("input_summary") for event in running_node_events))

    def test_customer_context_is_stable(self) -> None:
        self.assertEqual(
            make_customer_context("conversation-stable"),
            make_customer_context("conversation-stable"),
        )


if __name__ == "__main__":
    unittest.main()
