#!/usr/bin/env python3
"""Delete the two test-scaffold device docs left behind by the sandbox e2e test."""
from pathlib import Path
import json, sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from firestore_client import FirestoreClient


def main():
    cfg = json.loads((HERE / "devices.json").read_text(encoding="utf-8"))
    fc = FirestoreClient(
        project=cfg["project"],
        database=cfg["database"],
        service_account_key=cfg["service_account_key"],
        scope=cfg["firestore_scope"],
        mode=cfg.get("mode", "emulator"),
        collection=cfg["collection"],
        emulator_host=cfg.get("emulator_host"),
    )

    for tid in ["test-scaffold-1", "test-scaffold-2"]:
        fc.delete_doc(cfg["collection"], tid)
        print(f"deleted {cfg['collection']}/{tid}")

    print("cleanup complete.")


if __name__ == "__main__":
    main()
