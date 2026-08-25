"""Classify a natural-language question and plan retrieval strategies.

No ML. Pure rules and patterns. Converts "Who is my friend in Bahadurgarh?"
into a structured intent that the retrieval system acts on automatically,
without any user guidance.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

# Indian cities and locations for entity extraction
KNOWN_LOCATIONS = {
    "delhi", "mumbai", "bangalore", "bengaluru", "hyderabad", "chennai",
    "kolkata", "pune", "ahmedabad", "jaipur", "lucknow", "chandigarh",
    "gurgaon", "gurugram", "noida", "faridabad", "ghaziabad", "dwarka",
    "bahadurgarh", "rohtak", "jhajjar", "sonipat", "panipat", "karnal",
    "hisar", "ambala", "yamunanagar", "bhiwani", "rewari", "palwal",
    "dehradun", "haridwar", "agra", "mathura", "aligarh", "meerut",
    "moradabad", "bareilly", "kanpur", "varanasi", "prayagraj", "allahabad",
    "patna", "ranchi", "bhopal", "indore", "nagpur", "surat", "rajkot",
    "vadodara", "coimbatore", "madurai", "visakhapatnam", "vijayawada",
    "kochi", "thiruvananthapuram", "bhubaneswar", "guwahati",
    "shimla", "manali", "mussoorie", "nainital", "rishikesh",
}

RELATIONSHIP_WORDS = {
    "friend", "friends", "yaar", "dost", "buddy",
    "colleague", "coworker", "co-worker",
    "client", "customer",
    "family", "relative", "bhai", "didi", "bhaiya", "chacha", "mama",
    "classmate", "batchmate", "schoolmate",
    "neighbour", "neighbor",
    "partner", "investor",
}

QUESTION_STARTERS = {
    "WHO":   re.compile(r"\b(who|kaun|kiska|kiski|koi)\b", re.I),
    "WHAT":  re.compile(r"\b(what|kya|konsa|konsi|kitna|kitni)\b", re.I),
    "WHEN":  re.compile(r"\b(when|kab|kis\s+din|kitne\s+baje)\b", re.I),
    "WHERE": re.compile(r"\b(where|kahan|kidhar)\b", re.I),
    "HOW":   re.compile(r"\b(how|kaise|kyun|kyu)\b", re.I),
    "WHY":   re.compile(r"\b(why|kyun|kyu|reason)\b", re.I),
}


@dataclass
class QueryIntent:
    question_type: str = "GENERAL"
    location: Optional[str] = None
    person: Optional[str] = None
    date_hint: Optional[str] = None
    relationship: Optional[str] = None
    raw_query: str = ""
    strategies: List[str] = field(default_factory=list)

    def describe(self) -> str:
        parts = ["type=%s" % self.question_type]
        if self.location:
            parts.append("location=%r" % self.location)
        if self.relationship:
            parts.append("relationship=%r" % self.relationship)
        if self.date_hint:
            parts.append("date=%r" % self.date_hint)
        parts.append("strategies=%s" % self.strategies)
        return "Intent(%s)" % ", ".join(parts)


class QueryRouter:
    """Classify a question and decide which retrieval strategies to run."""

    def classify(self, question: str) -> QueryIntent:
        intent = QueryIntent(raw_query=question)
        q = question.lower()

        # Question type
        for qtype, pattern in QUESTION_STARTERS.items():
            if pattern.search(q):
                intent.question_type = qtype
                break

        # Location — known list first
        for loc in sorted(KNOWN_LOCATIONS, key=len, reverse=True):
            if loc in q:
                intent.location = loc
                break
        # Fallback: "in/at/near [CapitalizedWord]"
        if not intent.location:
            m = re.search(
                r"\b(?:in|at|near|from|to)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b",
                question,
            )
            if m:
                intent.location = m.group(1).lower()

        # Relationship
        for rel in RELATIONSHIP_WORDS:
            if rel in q:
                intent.relationship = rel
                break

        # Date hint
        for dp in [
            r"\b(\d{4}-\d{2}-\d{2})\b",
            r"\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\b",
            r"\b(january|february|march|april|may|june|july|august"
            r"|september|october|november|december)\b",
            r"\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b",
            r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
            r"\b(yesterday|aaj|kal|today|last\s+\w+|this\s+\w+)\b",
            r"\b(20\d{2})\b",
        ]:
            m = re.search(dp, q, re.I)
            if m:
                intent.date_hint = m.group(1)
                break

        intent.strategies = self._plan(intent)
        return intent

    def _plan(self, intent: QueryIntent) -> List[str]:
        strategies = ["direct"]  # always try direct first

        if intent.question_type == "WHO":
            if intent.location:
                strategies += [
                    "location_to_visits",
                    "visit_to_contacts",
                    "chrome_location_search",
                    "whatsapp_location",
                ]
            if intent.relationship:
                strategies.append("relationship_search")
            if intent.date_hint:
                strategies.append("date_contacts")

        elif intent.question_type in ("WHEN", "WHERE"):
            strategies += ["timeline_search", "chrome_location_search"]

        elif intent.question_type == "WHAT":
            strategies += ["semantic_search"]

        strategies.append("broad_search")  # always last fallback
        return strategies
