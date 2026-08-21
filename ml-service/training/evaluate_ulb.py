"""Compares saved ULB artefacts side by side. Run before promoting a version."""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="models")
    args = parser.parse_args()

    files = sorted(Path(args.dir).glob("metadata_ulb*.json"))
    if not files:
        raise SystemExit("No ULB metadata found. Run training/train_ulb.py first.")

    print(f"{'version':<14}{'model':<24}{'PR AUC':>9}{'recall':>9}{'prec':>9}{'FP':>7}")
    for f in files:
        m = json.loads(f.read_text())
        met = m.get("metrics", {})
        print(f"{m.get('version', '?'):<14}{m.get('name', '?'):<24}"
              f"{met.get('prAuc', 0):>9.4f}{met.get('recall', 0):>9.2%}"
              f"{met.get('precision', 0):>9.2%}{met.get('falsePositives', 0):>7}")

    print("\nPromote on PR AUC and the alert-budget table, not ROC AUC.")


if __name__ == "__main__":
    main()
