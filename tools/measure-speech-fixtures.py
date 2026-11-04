#!/usr/bin/env python3
"""Small-fixture WER, not a corpus or speaker-recognition benchmark."""
import argparse
import json
import pathlib
import re


def tokens(text):
    # Case-fold, remove apostrophes, strip punctuation; retain accents/numerals.
    return re.findall(r"\w+", text.casefold().replace("'", "").replace("’", ""))


def word_distance(reference, hypothesis):
    row = list(range(len(hypothesis) + 1))
    for i, word in enumerate(reference, 1):
        next_row = [i]
        for j, other in enumerate(hypothesis, 1):
            next_row.append(min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (word != other)))
        row = next_row
    return row[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / "target/processing-validation")
    args = parser.parse_args()
    base = args.directory
    truth = json.loads((base / "fixtures/scene-truth.json").read_text())
    references = {s["id"]: s["text"] for s in json.loads((base / "fixtures/provenance.json").read_text())["samples"]}
    result = {"normalization": "casefold; delete apostrophes; unicode word tokens; numerals not expanded", "not_a_benchmark": True, "scenes": {}}
    for scene, tracks in truth.items():
        path = base / (scene + "-report.json")
        if not path.exists():
            continue
        report = json.loads(path.read_text())
        result["scenes"][scene] = {}
        for track, clips in tracks.items():
            expected = " ".join(references[s["clip"]] for s in clips)
            actual = " ".join(s["text"] for s in report["segments"] if s["track"] == track)
            a, b = tokens(expected), tokens(actual)
            errors = word_distance(a, b)
            result["scenes"][scene][track] = {"reference_words": len(a), "word_errors": errors, "wer": errors / len(a) if a else None,
                "hypothesis": actual, "attributed_segments": sum(s["speaker"] is not None for s in report["segments"] if s["track"] == track)}
    portuguese = base / "portuguese-report.json"
    if portuguese.exists():
        report = json.loads(portuguese.read_text())
        expected = json.loads((base / "fixtures/portuguese/truth.json").read_text())
        result["scenes"]["portuguese"] = {}
        for track in ["mic", "output"]:
            hypothesis = " ".join(s["text"] for s in report["segments"] if s["track"] == track)
            a, b = tokens(expected[track]["text"]), tokens(hypothesis)
            errors = word_distance(a, b)
            result["scenes"]["portuguese"][track] = {"reference_words": len(a), "word_errors": errors, "wer": errors / len(a), "hypothesis": hypothesis}
    (base / "text-metrics.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    for name, tracks in result["scenes"].items():
        words = sum(t["reference_words"] for t in tracks.values())
        errors = sum(t["word_errors"] for t in tracks.values())
        print(f"{name}: {errors}/{words} word errors ({errors / words:.1%})" if words else f"{name}: silence")


if __name__ == "__main__":
    main()
