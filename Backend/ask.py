#!/usr/bin/env python3
"""
Ask your personal agent a question.

Usage:
    python tools/ask.py "Who is my friend in Bahadurgarh?"
    python tools/ask.py          # interactive REPL mode
"""

import os
import sys

# Resolve project root regardless of where the script is invoked from
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from personal_folder_agent.components.dynamic_retriever import DynamicRetriever

PARTS_DIR = os.path.join(ROOT, "runs", "jt_agent", "parts")


def ask(dr: DynamicRetriever, question: str) -> None:
    answer = dr.retrieve(question)
    print()
    print("=" * 70)
    print("Strategies tried : %s" % " → ".join(answer.strategies_tried))
    print("Overall confidence: %.0f%%" % (answer.confidence * 100))
    print("=" * 70)
    print()
    print(answer.context)
    print()


def main() -> None:
    if not os.path.isdir(PARTS_DIR):
        print("ERROR: parts directory not found: %s" % PARTS_DIR)
        print("Run the corpus build first (build_jt_chunks.py / build_db_chunks.py).")
        sys.exit(1)

    print("Loading corpus… (first run takes a moment)")
    dr = DynamicRetriever(PARTS_DIR)

    if len(sys.argv) > 1:
        # Single question from command line
        ask(dr, " ".join(sys.argv[1:]))
    else:
        # Interactive REPL
        print()
        print("Personal Agent — type your question, Ctrl+C to quit")
        print("Example: Who is my friend in Bahadurgarh?")
        while True:
            try:
                q = input("\n> ").strip()
            except (KeyboardInterrupt, EOFError):
                print()
                break
            if not q:
                continue
            ask(dr, q)


if __name__ == "__main__":
    main()
