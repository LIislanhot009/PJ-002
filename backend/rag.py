from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


DATA_PATH = Path(__file__).resolve().parent / "data" / "knowledge.json"

COMPLIANCE_PROFILES = {
    "kb-001": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-002": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-003": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-004": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-005": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-006": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-007": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-008": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-009": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
    "kb-010": {"status": "合规", "label": "内部合成数据", "license": "ForgeFlow Internal Demo", "sensitivity": "公开", "reviewed_at": "2026-07-31"},
}

for _demo_id in (
    "cs-demo-001",
    "cs-demo-002",
    "cs-demo-003",
    "cs-demo-004",
    "cs-demo-005",
    "cs-demo-006",
    "cs-demo-007",
    "cs-demo-008",
):
    COMPLIANCE_PROFILES[_demo_id] = {
        "status": "合规",
        "label": "客服模拟数据",
        "license": "ForgeFlow Customer Service Demo",
        "sensitivity": "公开",
        "reviewed_at": "2026-07-31",
    }


class LocalRag:
    def __init__(self, path: Path = DATA_PATH) -> None:
        self.documents: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))
        self.vectorizer = TfidfVectorizer(
            lowercase=True,
            analyzer="char",
            ngram_range=(2, 5),
            sublinear_tf=True,
        )
        self.matrix = self.vectorizer.fit_transform(
            [f"{doc['title']} {doc['tags']} {doc['content']}" for doc in self.documents]
        )

    def search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        vector = self.vectorizer.transform([query])
        scores = cosine_similarity(vector, self.matrix)[0]
        ranked = scores.argsort()[::-1][:limit]
        return [
            {
                **self.documents[index],
                "score": round(float(scores[index]), 3),
                "compliance": COMPLIANCE_PROFILES.get(self.documents[index]["id"], {
                    "status": "待审核",
                    "label": "未知来源",
                    "license": "未声明",
                    "sensitivity": "未知",
                    "reviewed_at": None,
                }),
            }
            for index in ranked
            if scores[index] > 0
        ]

    def get_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        by_id = {doc["id"]: doc for doc in self.documents}
        return [
            {
                **by_id[item_id],
                "score": 1.0,
                "compliance": COMPLIANCE_PROFILES.get(item_id, {
                    "status": "待审核",
                    "label": "未知来源",
                    "license": "未声明",
                    "sensitivity": "未知",
                    "reviewed_at": None,
                }),
            }
            for item_id in ids
            if item_id in by_id
        ]


rag = LocalRag()
