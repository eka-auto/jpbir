"""Orchestrates multi-path retrieval for a natural-language question.

Usage:
    from personal_folder_agent.components.dynamic_retriever import DynamicRetriever
    dr = DynamicRetriever("runs/jt_agent/parts")
    answer = dr.retrieve("Who is my friend in Bahadurgarh?")
    print(answer.context)      # formatted context ready for the model
    print(answer.confidence)   # 0.0–1.0
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from personal_folder_agent.components.query_router import QueryIntent, QueryRouter
from personal_folder_agent.components.retrieval_strategies import (
    CorpusIndex,
    RetrievalResult,
    RetrievalStrategies,
)


@dataclass
class RetrievalAnswer:
    question: str
    intent: QueryIntent
    all_results: List[RetrievalResult]
    best: Optional[RetrievalResult]
    context: str          # assembled context to send to the model
    strategies_tried: List[str] = field(default_factory=list)
    confidence: float = 0.0


class DynamicRetriever:
    """
    Multi-path retrieval engine.

    For each question it:
      1. Classifies question type + extracts entities  (QueryRouter)
      2. Selects relevant search strategies            (QueryRouter._plan)
      3. Runs those strategies in priority order       (RetrievalStrategies)
      4. Stops early on high confidence, else collects all
      5. Assembles a ranked context block for the model
    """

    EARLY_EXIT_THRESHOLD = 0.75  # stop running more strategies once we exceed this

    def __init__(self, parts_dir: str):
        self.index = CorpusIndex(parts_dir)
        self.strats = RetrievalStrategies(self.index)
        self.router = QueryRouter()

    def retrieve(self, question: str) -> RetrievalAnswer:
        intent = self.router.classify(question)
        print("\n[router] %s" % intent.describe())

        all_results: List[RetrievalResult] = []
        tried: List[str] = []

        for strategy_name in intent.strategies:
            tried.append(strategy_name)
            new = self._run(strategy_name, intent)
            if new:
                print("  [%s] %d results, best=%.0f%%" % (
                    strategy_name, len(new),
                    max(r.confidence for r in new) * 100))
            all_results.extend(new)

            # Early exit if we already have a very confident result
            if all_results:
                best_so_far = max(all_results, key=lambda r: r.confidence)
                if best_so_far.confidence >= self.EARLY_EXIT_THRESHOLD:
                    print("  [early exit] confidence %.0f%% >= threshold" % (
                        best_so_far.confidence * 100))
                    break

        all_results.sort(key=lambda r: -r.confidence)
        best = all_results[0] if all_results else None
        confidence = best.confidence if best else 0.0

        context = self._build_context(question, intent, all_results[:6])

        return RetrievalAnswer(
            question=question,
            intent=intent,
            all_results=all_results,
            best=best,
            context=context,
            strategies_tried=tried,
            confidence=confidence,
        )

    def _run(self, name: str, intent: QueryIntent) -> List[RetrievalResult]:
        s = self.strats
        loc = intent.location or ""
        rel = intent.relationship or ""
        try:
            if name == "direct":
                return s.direct(intent.raw_query)
            if name == "location_to_visits":
                return s.location_to_visits(loc)
            if name == "visit_to_contacts":
                return s.visit_to_contacts(loc)
            if name == "chrome_location_search":
                return s.chrome_location_search(loc)
            if name == "whatsapp_location":
                return s.whatsapp_location(loc)
            if name == "relationship_search":
                return s.relationship_search(rel, loc)
            if name == "date_contacts":
                return s.date_contacts(intent.date_hint or "")
            if name == "broad_search":
                return s.broad_search(intent.raw_query)
        except Exception as exc:
            print("  [%s ERROR] %s" % (name, exc))
        return []

    def _build_context(
        self,
        question: str,
        intent: QueryIntent,
        top: List[RetrievalResult],
    ) -> str:
        lines: List[str] = []
        lines.append("Question: %s" % question)
        lines.append("Interpreted as: %s-type question" % intent.question_type)
        if intent.location:
            lines.append("Location anchor: %s" % intent.location)
        if intent.relationship:
            lines.append("Relationship: %s" % intent.relationship)
        if intent.date_hint:
            lines.append("Date context: %s" % intent.date_hint)
        lines.append("")

        if not top:
            lines.append("No relevant data found in the corpus.")
            return "\n".join(lines)

        lines.append("Relevant evidence (%d sources):" % len(top))
        for i, r in enumerate(top, 1):
            lines.append("")
            lines.append("── Source %d  [%s | %.0f%% confidence] ──" % (
                i, r.strategy, r.confidence * 100))
            lines.append("File: %s" % r.source)
            # Truncate long chunks to keep context manageable
            text = r.text.strip()
            if len(text) > 1000:
                text = text[:1000] + "\n… [truncated]"
            lines.append(text)

        return "\n".join(lines)
