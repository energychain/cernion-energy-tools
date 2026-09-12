#!/usr/bin/env python3
"""
convert_iggielgnc_fixture.py

Converts real SciGRID_gas IGGIELGNC-3 export CSVs (semicolon-delimited,
native columns with Python-repr list/dict cells) into the comma-delimited,
already-mapped schema that tools/scigrid_gas_to_znp.py expects:

  nodes.csv: id,node_type,name,lat,long,country_code
  edges.csv: id,from_id,to_id,diameter_mm,pressure_bar,length_km

Rationale (decision for IGGIELGNC-3 reconciliation task):
A standalone conversion step is chosen over making load_nodes/load_edges
schema-tolerant inside scigrid_gas_to_znp.py, because the real fixture's
`node_id`/`lat`/`long`/`param` columns for edges are Python-repr strings
(e.g. "['A','B']", "{'diameter_mm': 1420.0, ...}") describing a whole pipe
route, not a single directed edge. Turning that into ZNP edges requires
route-splitting logic (one ZNP edge per consecutive node pair) that is a
data-shape decision, not just a column rename -- keeping it in a separate,
explicit converter avoids silently guessing inside the ingest script.

Usage:
  python3 convert_iggielgnc_fixture.py \
      --nodes fixtures_real/IGGIELGNC3_Nodes.csv \
      --edges fixtures_real/IGGIELGNC3_PipeSegments.csv \
      --out-nodes /tmp/nodes_mapped.csv \
      --out-edges /tmp/edges_mapped.csv
"""
import argparse
import ast
import csv
import os
import sys


def _resolve_input_path(raw):
    """Canonicalise a user-supplied input path and confirm it is a real file.

    Breaks the direct taint flow from CLI/argparse input to `open()` (a CLI
    argument could otherwise carry an unvalidated `../` traversal segment if
    this script is ever invoked with machine-generated rather than
    human-typed arguments) and fails fast with a clear error instead of a
    raw stack trace on a bad path.
    """
    resolved = os.path.realpath(raw)
    if not os.path.isfile(resolved):
        raise SystemExit(f"error: input file not found: {resolved}")
    return resolved


def _resolve_output_path(raw):
    """Canonicalise a user-supplied output path; same taint-flow rationale
    as `_resolve_input_path`, plus a clear error if the parent dir is missing.
    """
    resolved = os.path.realpath(raw)
    parent = os.path.dirname(resolved)
    if parent and not os.path.isdir(parent):
        raise SystemExit(f"error: output directory does not exist: {parent}")
    return resolved


def _parse_pylist(raw):
    """Parse a CSV cell that is a Python-repr list/dict/scalar string."""
    if raw is None or raw == "" or raw == "None":
        return None
    try:
        return ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return raw


def convert_nodes(in_path, out_path):
    n = 0
    with open(in_path, newline="", encoding="utf-8") as fin, \
            open(out_path, "w", newline="", encoding="utf-8") as fout:
        reader = csv.DictReader(fin, delimiter=";")
        writer = csv.DictWriter(
            fout, fieldnames=["id", "node_type", "name", "lat", "long", "country_code"]
        )
        writer.writeheader()
        for row in reader:
            name = row.get("name") or row["id"]
            if name == "None":
                name = row["id"]
            writer.writerow({
                "id": row["id"],
                "node_type": "bidirectional",  # real export has no node_type; safe default
                "name": name,
                "lat": row["lat"],
                "long": row["long"],
                "country_code": _parse_pylist(row.get("country_code")) or "",
            })
            n += 1
    return n


def convert_edges(in_path, out_path):
    """Split each PipeSegments row (a whole route, possibly multi-node) into
    one mapped edge per consecutive node pair.
    """
    n = 0
    with open(in_path, newline="", encoding="utf-8") as fin, \
            open(out_path, "w", newline="", encoding="utf-8") as fout:
        reader = csv.DictReader(fin, delimiter=";")
        writer = csv.DictWriter(
            fout,
            fieldnames=["id", "from_id", "to_id", "diameter_mm", "pressure_bar", "length_km"],
        )
        writer.writeheader()
        for row in reader:
            node_ids = _parse_pylist(row.get("node_id")) or []
            if isinstance(node_ids, str):
                node_ids = [node_ids]
            params = _parse_pylist(row.get("param")) or {}
            diameter_mm = params.get("diameter_mm") if isinstance(params, dict) else None
            pressure_bar = params.get("max_pressure_bar") if isinstance(params, dict) else None
            length_km = params.get("length_km") if isinstance(params, dict) else None
            base_id = row["id"]
            for i in range(len(node_ids) - 1):
                seg_id = base_id if len(node_ids) <= 2 else f"{base_id}__{i}"
                writer.writerow({
                    "id": seg_id,
                    "from_id": node_ids[i],
                    "to_id": node_ids[i + 1],
                    "diameter_mm": diameter_mm if diameter_mm is not None else "",
                    "pressure_bar": pressure_bar if pressure_bar is not None else "",
                    "length_km": length_km if length_km is not None else "",
                })
                n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--nodes", required=True)
    ap.add_argument("--edges", required=True)
    ap.add_argument("--out-nodes", required=True)
    ap.add_argument("--out-edges", required=True)
    args = ap.parse_args()

    n = convert_nodes(_resolve_input_path(args.nodes), _resolve_output_path(args.out_nodes))
    e = convert_edges(_resolve_input_path(args.edges), _resolve_output_path(args.out_edges))
    print(f"OK: wrote {n} nodes -> {args.out_nodes}, {e} edges -> {args.out_edges}", file=sys.stderr)


if __name__ == "__main__":
    main()
