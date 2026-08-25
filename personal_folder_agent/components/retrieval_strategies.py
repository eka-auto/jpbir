"""Retrieval strategy implementations.

Each strategy searches the corpus from a different angle. All strategies return
List[RetrievalResult] with a confidence score. The orchestrator picks the best.

No GPU, no embeddings — keyword-based with log-TF scoring. Fast enough to run
locally on every query; the heavy lifting (embeddings, reranking) stays on Colab.
"""

from __future__ import annotations

import collections
import json
import math
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class RetrievalResult:
    text: str
    source: str
    strategy: str
    confidence: float
    metadata: Dict = field(default_factory=dict)

    def brief(self) -> str:
        src = os.path.basename(self.source)[:50]
        return "%.0f%% [%s] %s" % (self.confidence * 100, self.strategy, src)


class CorpusIndex:
    """In-memory index of all JSONL parts. Load once; query fast."""

    def __init__(self, parts_dir: str):
        self.chunks: List[Dict] = []
        # Secondary indexes for targeted pool searches
        self.by_label: Dict[str, List[Dict]] = collections.defaultdict(list)
        self.by_kind: Dict[str, List[Dict]] = collections.defaultdict(list)
        self._load(parts_dir)

    def _load(self, parts_dir: str) -> None:
        if not os.path.isdir(parts_dir):
            print("CorpusIndex: parts directory not found: %s" % parts_dir)
            return
        for fname in sorted(os.listdir(parts_dir)):
            if not fname.endswith(".jsonl"):
                continue
            fpath = os.path.join(parts_dir, fname)
            with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except ValueError:
                        continue
                    self.chunks.append(chunk)
                    meta = chunk.get("metadata") or {}
                    label = meta.get("corpus_label", "")
                    kind = meta.get("kind", "")
                    if label:
                        self.by_label[label].append(chunk)
                    if kind:
                        self.by_kind[kind].append(chunk)

        print("CorpusIndex: %d chunks loaded from %s" % (len(self.chunks), parts_dir))
        if self.by_label:
            summary = ", ".join("%s:%d" % (k, len(v))
                                for k, v in sorted(self.by_label.items()))
            print("  Labels: " + summary)

    def search(
        self,
        terms: List[str],
        pool: Optional[List[Dict]] = None,
        top_k: int = 10,
    ) -> List[Tuple[float, Dict]]:
        """Score chunks by keyword presence. Returns (score, chunk) desc."""
        target = pool if pool is not None else self.chunks
        scored = []
        lower_terms = [t.lower() for t in terms if t]
        for chunk in target:
            text = (chunk.get("text") or "").lower()
            score = 0.0
            for term in lower_terms:
                count = text.count(term)
                if count:
                    score += math.log1p(count)
                    # Bonus when term appears in the first 200 chars (title-like)
                    if term in text[:200]:
                        score += 0.5
            if score > 0:
                scored.append((score, chunk))
        scored.sort(key=lambda x: -x[0])
        return scored[:top_k]


class RetrievalStrategies:
    """One method per retrieval path. All return List[RetrievalResult]."""

    def __init__(self, index: CorpusIndex):
        self.idx = index

    # ── direct: simple keyword hit across full corpus ─────────────────────

    def direct(self, query: str, top_k: int = 5) -> List[RetrievalResult]:
        terms = [t for t in re.split(r"\W+", query) if len(t) > 3]
        hits = self.idx.search(terms, top_k=top_k)
        out = []
        for score, chunk in hits:
            out.append(RetrievalResult(
                text=chunk.get("text", ""),
                source=chunk.get("source_file", ""),
                strategy="direct",
                confidence=min(0.9, score / 10.0),
                metadata=chunk.get("metadata") or {},
            ))
        return out

    # ── location_to_visits: when did I go to this location? ──────────────

    def location_to_visits(self, location: str) -> List[RetrievalResult]:
        if not location:
            return []
        chrome_pool = self.idx.by_label.get("databases", [])
        timeline_pool = self.idx.by_kind.get("day_card", [])
        out = []
        for pool, pool_name in [(chrome_pool, "chrome"), (timeline_pool, "timeline")]:
            for score, chunk in self.idx.search([location], pool=pool, top_k=5):
                text = chunk.get("text", "")
                dates = re.findall(r"20\d{2}-\d{2}-\d{2}", text)
                meta = {**(chunk.get("metadata") or {}),
                        "found_dates": dates, "pool": pool_name}
                out.append(RetrievalResult(
                    text=text,
                    source=chunk.get("source_file", ""),
                    strategy="location_to_visits",
                    confidence=min(0.8, score / 5.0),
                    metadata=meta,
                ))
        return out

    # ── visit_to_contacts: find who I contacted on visit dates ───────────

    def visit_to_contacts(self, location: str) -> List[RetrievalResult]:
        if not location:
            return []
        visit_results = self.location_to_visits(location)
        candidate_dates: List[str] = []
        for r in visit_results:
            candidate_dates.extend(r.metadata.get("found_dates", []))
        if not candidate_dates:
            return []

        timeline_pool = self.idx.by_kind.get("day_card", [])
        out = []
        for date in list(dict.fromkeys(candidate_dates))[:5]:  # unique, preserve order
            for score, chunk in self.idx.search([date], pool=timeline_pool, top_k=3):
                text = chunk.get("text", "")
                call_lines = [l for l in text.splitlines()
                              if re.search(r"\b(call|spoke|rang|phone|contact)\b", l, re.I)]
                meta = {**(chunk.get("metadata") or {}),
                        "date": date, "call_lines": call_lines[:5]}
                out.append(RetrievalResult(
                    text=text,
                    source=chunk.get("source_file", ""),
                    strategy="visit_to_contacts",
                    confidence=min(0.9, 0.4 + 0.1 * len(call_lines)),
                    metadata=meta,
                ))
        return out

    # ── chrome_location_search: maps/directions/searches for location ─────

    def chrome_location_search(self, location: str) -> List[RetrievalResult]:
        if not location:
            return []
        chrome_pool = self.idx.by_label.get("databases", [])
        out = []
        for score, chunk in self.idx.search([location], pool=chrome_pool, top_k=10):
            text = chunk.get("text", "")
            text_l = text.lower()
            is_maps = any(t in text_l for t in ["maps", "directions", "navigate", "route", "maps.google"])
            confidence = min(0.8, score / 5.0)
            if is_maps:
                confidence = min(0.9, confidence + 0.2)
            out.append(RetrievalResult(
                text=text,
                source=chunk.get("source_file", ""),
                strategy="chrome_location_search",
                confidence=confidence,
                metadata=chunk.get("metadata") or {},
            ))
        return out

    # ── whatsapp_location: WhatsApp messages mentioning the location ──────

    def whatsapp_location(self, location: str) -> List[RetrievalResult]:
        if not location:
            return []
        wa_pool = self.idx.by_label.get("whatsapp", [])
        out = []
        for score, chunk in self.idx.search([location], pool=wa_pool, top_k=5):
            out.append(RetrievalResult(
                text=chunk.get("text", ""),
                source=chunk.get("source_file", ""),
                strategy="whatsapp_location",
                confidence=min(0.85, score / 4.0),
                metadata=chunk.get("metadata") or {},
            ))
        return out

    # ── relationship_search: e.g. "friend in Bahadurgarh" ────────────────

    def relationship_search(self, relationship: str, location: Optional[str] = None) -> List[RetrievalResult]:
        terms = [t for t in [relationship, location] if t]
        out = []
        for score, chunk in self.idx.search(terms, top_k=5):
            out.append(RetrievalResult(
                text=chunk.get("text", ""),
                source=chunk.get("source_file", ""),
                strategy="relationship_search",
                confidence=min(0.75, score / 8.0),
                metadata=chunk.get("metadata") or {},
            ))
        return out

    # ── date_contacts: find contacts/events around a date hint ───────────

    def date_contacts(self, date_hint: str) -> List[RetrievalResult]:
        if not date_hint:
            return []
        timeline_pool = self.idx.by_kind.get("day_card", [])
        out = []
        for score, chunk in self.idx.search([date_hint], pool=timeline_pool, top_k=5):
            out.append(RetrievalResult(
                text=chunk.get("text", ""),
                source=chunk.get("source_file", ""),
                strategy="date_contacts",
                confidence=min(0.7, score / 5.0),
                metadata=chunk.get("metadata") or {},
            ))
        return out

    # ── broad_search: loosest keyword match, always last fallback ─────────

    def broad_search(self, query: str) -> List[RetrievalResult]:
        terms = [t for t in re.split(r"\W+", query) if len(t) > 2]
        out = []
        for score, chunk in self.idx.search(terms, top_k=3):
            out.append(RetrievalResult(
                text=chunk.get("text", ""),
                source=chunk.get("source_file", ""),
                strategy="broad_search",
                confidence=min(0.5, score / 15.0),
                metadata=chunk.get("metadata") or {},
            ))
        return out
