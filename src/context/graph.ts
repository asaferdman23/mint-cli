/**
 * Dependency graph — adjacency list with BFS/DFS traversal.
 * Used by the indexer to map import relationships and by search
 * to expand relevant files to their immediate dependencies.
 */

export interface GraphNode {
  path: string;
  imports: string[];   // files this node imports
  importedBy: string[]; // files that import this node (reverse edges)
}

export class DependencyGraph {
  private nodes = new Map<string, GraphNode>();

  /** Add a file and its import edges. */
  addFile(path: string, imports: string[]): void {
    const node = this.getOrCreate(path);
    node.imports = imports;

    // Build reverse edges
    for (const imp of imports) {
      const target = this.getOrCreate(imp);
      if (!target.importedBy.includes(path)) {
        target.importedBy.push(path);
      }
    }
  }

  /** Get a node by path. */
  get(path: string): GraphNode | undefined {
    return this.nodes.get(path);
  }

  /** Get all file paths in the graph. */
  allPaths(): string[] {
    return Array.from(this.nodes.keys());
  }

  /** Get the number of files in the graph. */
  get size(): number {
    return this.nodes.size;
  }

  /**
   * BFS from a set of seed files, expanding up to `maxDepth` levels.
   * Returns all reachable files (both forward imports and reverse importedBy).
   */
  expand(seeds: string[], maxDepth: number = 1): string[] {
    const visited = new Set<string>(seeds);
    let frontier = [...seeds];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const path of frontier) {
        const node = this.nodes.get(path);
        if (!node) continue;

        for (const neighbor of [...node.imports, ...node.importedBy]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }

    return Array.from(visited);
  }

  /**
   * Find the most "central" files — those with the highest combined
   * in-degree + out-degree. These are typically core modules.
   */
  centralFiles(topN: number = 10): Array<{ path: string; degree: number }> {
    const scored: Array<{ path: string; degree: number }> = [];
    for (const [path, node] of this.nodes) {
      scored.push({ path, degree: node.imports.length + node.importedBy.length });
    }
    scored.sort((a, b) => b.degree - a.degree);
    return scored.slice(0, topN);
  }

  /** Serialize to a plain object for JSON persistence. */
  toJSON(): Record<string, { imports: string[]; importedBy: string[] }> {
    const out: Record<string, { imports: string[]; importedBy: string[] }> = {};
    for (const [path, node] of this.nodes) {
      out[path] = { imports: node.imports, importedBy: node.importedBy };
    }
    return out;
  }

  /** Restore from a serialized object. */
  static fromJSON(data: Record<string, { imports: string[]; importedBy: string[] }>): DependencyGraph {
    const graph = new DependencyGraph();
    for (const [path, edges] of Object.entries(data)) {
      const node = graph.getOrCreate(path);
      node.imports = edges.imports;
      node.importedBy = edges.importedBy;
    }
    return graph;
  }

  private getOrCreate(path: string): GraphNode {
    let node = this.nodes.get(path);
    if (!node) {
      node = { path, imports: [], importedBy: [] };
      this.nodes.set(path, node);
    }
    return node;
  }
}
