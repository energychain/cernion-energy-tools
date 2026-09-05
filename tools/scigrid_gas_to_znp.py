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
import ast
import csv
import json
import sys
from datetime import datetime, timezone

# SciGRID_gas node_type -> ZNP asset kind used elsewhere in the schema
NODE_TYPE_MAP = {
    "entry": "GAS_ENTRY",
    "exit": "GAS_EXIT",
    "bidirectional": "GAS_BIDIRECTIONAL",
    "compressor": "GAS_COMPRESSOR",
    "storage": "GAS_STORAGE",
    "lng": "GAS_LNG_TERMINAL",
}


def _sniff_delimiter(path):
    # Real SciGRID_gas exports use ';' delimiters; the small offline sample
    # uses ','. Detect per-file so both work.
    with open(path, newline="", encoding="utf-8") as f:
        header = f.readline()
    return ";" if header.count(";") > header.count(",") else ","


def _parse_pylist(value):
    """Parse a Python-repr list literal (e.g. "['a', 'b']") as found in the
    real SciGRID_gas param/node_id/country_code columns. Returns [] on any
    failure (including plain scalar strings that aren't list literals)."""
    if not value:
        return []
    try:
        parsed = ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return []
    if isinstance(parsed, (list, tuple)):
        return list(parsed)
    return [parsed]


def _parse_dict_literal(value):
    if not value:
        return {}
    try:
        parsed = ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def load_nodes(path):
    nodes = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=_sniff_delimiter(path)):
            nodes.append(row)
    return nodes


def _derive_edge_endpoints(row):
    """Real IGGIELGNC-3 PipeSegments.csv has no from_id/to_id columns; instead
    each row's `node_id` column holds a 2-element Python-list literal of the
    two endpoint node ids, e.g. "['INET_N_856', 'SEQ_7_p']". Fall back to
    from_id/to_id when present (offline sample fixture schema)."""
    if row.get("from_id") and row.get("to_id"):
        return row["from_id"], row["to_id"]

    endpoints = _parse_pylist(row.get("node_id", ""))
    if len(endpoints) < 2:
        raise KeyError(
            f"edge {row.get('id')}: cannot derive endpoints from node_id={row.get('node_id')!r}"
        )
    return endpoints[0], endpoints[-1]


def _parse_param_field(row, key):
    """Real edges store diameter/pressure/length inside a `param` dict-literal
    column rather than dedicated CSV columns. Fall back to a direct column
    (offline sample schema) when present."""
    if row.get(key) not in (None, ""):
        return row.get(key)
    return _parse_dict_literal(row.get("param")).get(key)


def _derive_edge_country_codes(row):
    """Real edges store cross-border info as a `country_code` column holding
    either a plain scalar (single-country segment) or a 2-element list
    literal, e.g. "['ES', 'PT']" (cross-border segment). Falls back to
    dedicated country_code_from/to columns (offline sample schema) when
    present."""
    if row.get("country_code_from") or row.get("country_code_to"):
        return (
            row.get("country_code_from") or None,
            row.get("country_code_to") or None,
        )

    codes = _parse_pylist(row.get("country_code", ""))
    if len(codes) >= 2:
        return codes[0], codes[-1]
    if len(codes) == 1:
        return codes[0], codes[0]
    single = row.get("country_code") or None
    return single, single


def _node_type_from_tags(node):
    """Real IGGIELGNC-3 Nodes.csv has no `node_type` column at all; classify
    from a direct column when present (offline sample schema), else fall
    back to hints in the `tags`/`comment`/`method` free-text columns used by
    the real export. Defaults to a generic gas asset when nothing matches."""
    if node.get("node_type"):
        return node["node_type"]

    haystack = " ".join(
        str(node.get(field, "")).lower()
        for field in ("tags", "comment", "method", "name")
    )
    for keyword in ("lng", "storage", "compressor", "bidirectional", "entry", "exit"):
        if keyword in haystack:
            return keyword
    return ""


def load_edges(path):
    edges = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=_sniff_delimiter(path)):
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
        kind = NODE_TYPE_MAP.get(_node_type_from_tags(n), "GAS_ASSET")
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
        source_id, target_id = _derive_edge_endpoints(e)
        diameter_mm = _parse_param_field(e, "diameter_mm")
        pressure_bar = _parse_param_field(e, "pressure_bar")
        length_km = _parse_param_field(e, "length_km")
        country_code_from, country_code_to = _derive_edge_country_codes(e)
        is_cross_border = bool(
            country_code_from and country_code_to and country_code_from != country_code_to
        )
        edge_key = e.get("id") or f"{source_id}->{target_id}"
        gedges.append({
            "key": edge_key,
            "source": source_id,
            "target": target_id,
            "attributes": {
                "kind": "GAS_PIPELINE",
                "commodity": "gas",
                "diameter_mm": float(diameter_mm) if diameter_mm not in (None, "") else None,
                "pressure_bar": float(pressure_bar) if pressure_bar not in (None, "") else None,
                "length_km": float(length_km) if length_km not in (None, "") else None,
                "source": "scigrid_gas",
                "country_code_from": country_code_from,
                "country_code_to": country_code_to,
                "is_cross_border": is_cross_border,
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

    nodes = load_nodes(args.nodes)
    edges = load_edges(args.edges)

    graph_export, meta_doc = to_znp_graph(nodes, edges, args.project_id, args.root_node_id)

    # Validation: every edge endpoint must resolve to a known node
    node_ids = {n["key"] for n in graph_export["nodes"]}
    for e in graph_export["edges"]:
        if e["source"] not in node_ids or e["target"] not in node_ids:
            print(f"ERROR: edge {e['key']} references unknown node", file=sys.stderr)
            sys.exit(1)

    out_json = json.dumps(graph_export, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(out_json)
    else:
        print(out_json)

    if args.meta_out:
        with open(args.meta_out, "w", encoding="utf-8") as f:
            json.dump(meta_doc, f, indent=2)

    print(
        f"OK: mapped {len(graph_export['nodes'])} nodes / {len(graph_export['edges'])} edges "
        f"for project={args.project_id} commodity=gas",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
