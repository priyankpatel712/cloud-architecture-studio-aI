import json
from pathlib import Path
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json
from graphify.diagnostics import diagnose_extraction, format_diagnostic_report

def run_phase_1():
    # 1. Merge AST + Semantic
    ast = json.loads(Path('graphify-out/.graphify_ast.json').read_text(encoding="utf-8"))
    
    sem_path = Path('graphify-out/.graphify_semantic.json')
    if not sem_path.exists():
        new_sem = Path('graphify-out/.graphify_semantic_new.json')
        if new_sem.exists():
            sem = json.loads(new_sem.read_text(encoding="utf-8"))
        else:
            sem = {'nodes': [], 'edges': [], 'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0}
        sem_path.write_text(json.dumps(sem, indent=2, ensure_ascii=False), encoding="utf-8")
    else:
        sem = json.loads(sem_path.read_text(encoding="utf-8"))
        
    seen = {n['id'] for n in ast['nodes']}
    merged_nodes = list(ast['nodes'])
    for n in sem.get('nodes', []):
        if n['id'] not in seen:
            merged_nodes.append(n)
            seen.add(n['id'])
            
    merged_edges = ast['edges'] + sem.get('edges', [])
    merged_hyperedges = sem.get('hyperedges', [])
    
    merged = {
        'nodes': merged_nodes,
        'edges': merged_edges,
        'hyperedges': merged_hyperedges,
        'input_tokens': sem.get('input_tokens', 0),
        'output_tokens': sem.get('output_tokens', 0),
    }
    
    extract_path = Path('graphify-out/.graphify_extract.json')
    extract_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Merged: {len(merged_nodes)} nodes, {len(merged_edges)} edges")
    
    # 2. Build graph & cluster
    G = build_from_json(merged, root='.', directed=False)
    if G.number_of_nodes() == 0:
        print("ERROR: Graph is empty.")
        return
        
    communities = cluster(G)
    cohesion = score_all(G, communities)
    
    # Write to a JSON file instead of printing unicode directly to console
    comm_summary = []
    for cid, nodes in sorted(communities.items()):
        comm_summary.append({
            "community_id": cid,
            "size": len(nodes),
            "top_nodes": nodes[:10]
        })
    Path('graphify-out/communities_summary.json').write_text(json.dumps(comm_summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Saved communities summary to graphify-out/communities_summary.json")
        
    # Write intermediate analysis file
    analysis = {
        'communities': {str(k): v for k, v in communities.items()},
        'cohesion': {str(k): v for k, v in cohesion.items()},
        'gods': god_nodes(G),
        'surprises': surprising_connections(G, communities),
    }
    Path('graphify-out/.graphify_analysis.json').write_text(json.dumps(analysis, indent=2, ensure_ascii=False), encoding="utf-8")

if __name__ == '__main__':
    run_phase_1()
