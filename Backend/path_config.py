#!/usr/bin/env python3
"""Shared path configuration for local training/runtime data."""
import os
from pathlib import Path

TRAINING_DATA_DIR = Path(os.environ.get("TRAINING_DATA_DIR", r"D:\training-data"))

