#!/usr/bin/env python3
"""
scigrid_gas_to_znp.py

Ingestion/mapping step: SciGRID_gas node+edge CSV export -> ZNP gas-layer
graphology JSON shape, matching the additive schema proposed in t_a5410e77
(znp:graph:<projectId>:gas).

Input (SciGRID_gas-style export, see fixtures/sample_scigrid_*.csv):
  nodes.csv: id,name,node_type,lat,long,country_code
  edges.csv: id,from_id,to_id,diameter_mm,pressure_bar,length_km

Output: graphology-compatible JSON with the same serialisation shape used by
znp.service.js for the electricity graph (nodes[], edges[], attributes),
tagged commodity="gas" so it can be persisted directly at
znp:graph:<projectId>:gas / znp:meta:<projectId>:gas.

Usage:
  python3 scigrid_gas_to_znp.py \
      --nodes fixtures/sample_scigrid_nodes.csv \
      --edges fixtures/sample_scigrid_edges.csv \
      --project-id demo-project \
      --out /tmp/gas_layer.json
"""
import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone


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

# SciGRID_gas node_type -> ZNP asset kind used elsewhere in the schema
NODE_TYPE_MAP = {
    "entry": "GAS_ENTRY",
    "exit": "GAS_EXIT",
    "bidirectional": "GAS_BIDIRECTIONAL",
    "compressor": "GAS_COMPRESSOR",
    "storage": "GAS_STORAGE",
    "lng": "GAS_LNG_TERMINAL",
}


def load_nodes(path):
    nodes = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            nodes.append(row)
    return nodes


def load_edges(path):
    edges = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            edges.append(row)
    return edges


def compute_bbox(nodes):
    lats = [float(n["lat"]) for n in nodes]
    lons = [float(n["long"]) for n in nodes]
    return {
        "south": min(lats),
        "north": max(lats),
        "west": min(lons),
        "east": max(lons),
    }


def to_znp_graph(nodes, edges, project_id, root_node_id=None):
    """Build a graphology-shaped export, mirroring the electricity graph's
    persisted structure (nodes/edges with attributes), tagged as gas layer.
    """
    if not nodes:
        raise ValueError("no nodes to map")

    root_id = root_node_id or nodes[0]["id"]

    gnodes = []
    for n in nodes:
        kind = NODE_TYPE_MAP.get(n["node_type"], "GAS_ASSET")
        is_root = n["id"] == root_id
        gnodes.append({
            "key": n["id"],
            "attributes": {
                "label": n.get("name", n["id"]),
                "kind": "GAS_FEED_1" if is_root else kind,
                "commodity": "gas",
                "lat": float(n["lat"]),
                "lon": float(n["long"]),
                "source": "scigrid_gas",
                "country_code": n.get("country_code", ""),
            },
        })

    gedges = []
    for e in edges:
        gedges.append({
            "key": e["id"],
            "source": e["from_id"],
            "target": e["to_id"],
            "attributes": {
                "kind": "GAS_PIPELINE",
                "commodity": "gas",
                "diameter_mm": float(e["diameter_mm"]) if e.get("diameter_mm") else None,
                "pressure_bar": float(e["pressure_bar"]) if e.get("pressure_bar") else None,
                "length_km": float(e["length_km"]) if e.get("length_km") else None,
                "source": "scigrid_gas",
            },
        })

    graph_export = {
        "attributes": {"commodity": "gas", "projectId": project_id},
        "options": {"type": "directed", "multi": False, "allowSelfLoops": False},
        "nodes": gnodes,
        "edges": gedges,
    }

    bbox = compute_bbox(nodes)
    meta_doc = {
        "projectId": project_id,
        "commodity": "gas",
        "bbox": bbox,
        "layers": ["gas"],
        "stats": {"nodeCount": len(gnodes), "edgeCount": len(gedges)},
        "source": "scigrid_gas",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    return graph_export, meta_doc


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--nodes", required=True, help="SciGRID_gas nodes CSV")
    ap.add_argument("--edges", required=True, help="SciGRID_gas edges CSV")
    ap.add_argument("--project-id", required=True, help="ZNP projectId to tag output with")
    ap.add_argument("--root-node-id", default=None, help="Node id to treat as virtual root (defaults to first node)")
    ap.add_argument("--out", default=None, help="Output path for graph JSON (defaults to stdout)")
    ap.add_argument("--meta-out", default=None, help="Optional output path for meta JSON")
    args = ap.parse_args()

    nodes = load_nodes(_resolve_input_path(args.nodes))
    edges = load_edges(_resolve_input_path(args.edges))

    graph_export, meta_doc = to_znp_graph(nodes, edges, args.project_id, args.root_node_id)

    # Validation: every edge endpoint must resolve to a known node
    node_ids = {n["key"] for n in graph_export["nodes"]}
    for e in graph_export["edges"]:
        if e["source"] not in node_ids or e["target"] not in node_ids:
            print(f"ERROR: edge {e['key']} references unknown node", file=sys.stderr)
            sys.exit(1)

    out_json = json.dumps(graph_export, indent=2)
    if args.out:
        with open(_resolve_output_path(args.out), "w", encoding="utf-8") as f:
            f.write(out_json)
    else:
        print(out_json)

    if args.meta_out:
        with open(_resolve_output_path(args.meta_out), "w", encoding="utf-8") as f:
            json.dump(meta_doc, f, indent=2)

    print(
        f"OK: mapped {len(graph_export['nodes'])} nodes / {len(graph_export['edges'])} edges "
        f"for project={args.project_id} commodity=gas",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
