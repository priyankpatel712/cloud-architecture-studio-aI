import json
import re
from pathlib import Path
from graphify.cache import save_semantic_cache

def parse_markdown(content, rel_path):
    nodes = []
    edges = []
    
    # Doc node
    doc_id = rel_path.replace('\\', '/')
    doc_name = Path(rel_path).name
    nodes.append({
        "id": doc_id,
        "label": doc_name,
        "type": "document",
        "properties": {
            "path": doc_id,
            "description": f"Markdown document: {doc_name}"
        },
        "source_file": str(Path(rel_path).resolve())
    })
    
    # Simple header parsing
    lines = content.split('\n')
    current_section = doc_id
    for idx, line in enumerate(lines):
        # Header
        header_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if header_match:
            level = len(header_match.group(1))
            title = header_match.group(2).strip()
            section_id = f"{doc_id}#{title.lower().replace(' ', '-')}"
            nodes.append({
                "id": section_id,
                "label": title,
                "type": f"header_l{level}",
                "properties": {
                    "title": title,
                    "level": level,
                    "line_number": idx + 1
                },
                "source_file": str(Path(rel_path).resolve())
            })
            # Link section to document or parent section
            edges.append({
                "source": doc_id,
                "target": section_id,
                "relation": "contains",
                "properties": {},
                "source_file": str(Path(rel_path).resolve())
            })
            current_section = section_id
            
        # Links
        links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', line)
        for text, url in links:
            if url.startswith('file:///'):
                # Local file reference
                ref_path = url.replace('file:///', '')
                ref_rel = Path(ref_path).name
                edges.append({
                    "source": current_section,
                    "target": ref_rel,
                    "relation": "references_file",
                    "properties": {"text": text, "url": url},
                    "source_file": str(Path(rel_path).resolve())
                })
            elif url.startswith('.') or '/' in url:
                # Relative or absolute link
                edges.append({
                    "source": current_section,
                    "target": url,
                    "relation": "references_link",
                    "properties": {"text": text, "url": url},
                    "source_file": str(Path(rel_path).resolve())
                })
                
    return nodes, edges

def parse_svg(content, rel_path):
    doc_id = rel_path.replace('\\', '/')
    doc_name = Path(rel_path).name
    nodes = [{
        "id": doc_id,
        "label": doc_name,
        "type": "image",
        "properties": {
            "path": doc_id,
            "description": f"SVG image asset: {doc_name}"
        },
        "source_file": str(Path(rel_path).resolve())
    }]
    return nodes, []

def run():
    uncached_path = Path('graphify-out/.graphify_uncached.txt')
    if not uncached_path.exists():
        print("No uncached file list found.")
        return
        
    uncached_files = uncached_path.read_text(encoding='utf-8').splitlines()
    if not uncached_files:
        print("No uncached files to process.")
        return
        
    all_nodes = []
    all_edges = []
    
    root_dir = Path('.').resolve()
    
    for f in uncached_files:
        p = Path(f)
        if not p.exists():
            continue
            
        # Get relative path for node ID
        try:
            rel_path = str(p.relative_to(root_dir))
        except ValueError:
            rel_path = str(p)
            
        try:
            content = p.read_text(encoding='utf-8', errors='ignore')
        except Exception as e:
            print(f"Error reading {p}: {e}")
            continue
            
        if p.suffix == '.md':
            nodes, edges = parse_markdown(content, rel_path)
            all_nodes.extend(nodes)
            all_edges.extend(edges)
        elif p.suffix == '.svg':
            nodes, edges = parse_svg(content, rel_path)
            all_nodes.extend(nodes)
            all_edges.extend(edges)
            
    # Save to semantic cache
    if all_nodes or all_edges:
        saved = save_semantic_cache(all_nodes, all_edges, root=root_dir)
        print(f"Heuristic extraction: cached {saved} files, {len(all_nodes)} nodes, {len(all_edges)} edges")
        
        # Write .graphify_semantic_new.json
        Path('graphify-out/.graphify_semantic_new.json').write_text(json.dumps({
            "nodes": all_nodes,
            "edges": all_edges,
            "hyperedges": [],
            "input_tokens": 0,
            "output_tokens": 0
        }, indent=2, ensure_ascii=False), encoding='utf-8')
    else:
        print("No new nodes/edges extracted.")

if __name__ == '__main__':
    run()
