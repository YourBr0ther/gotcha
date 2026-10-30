/**
 * A grid navmesh. One cell per block column; a cell is walkable when the
 * ground there is flat and nothing stands on it. Paths come from A* over
 * eight neighbours without cutting corners, so a creature never clips a
 * block edge on a diagonal.
 */

export interface GridCell {
  cx: number;
  cz: number;
}

export interface NavGrid {
  /** World X and Z of cell (0, 0)'s minimum corner. */
  originX: number;
  originZ: number;
  width: number;
  depth: number;
  /** 1 when walkable. Row-major, index = cz * width + cx. */
  walkable: Uint8Array;
}

export function createNavGrid(originX: number, originZ: number, width: number, depth: number): NavGrid {
  return { originX, originZ, width, depth, walkable: new Uint8Array(width * depth) };
}

export function inGrid(grid: NavGrid, cx: number, cz: number): boolean {
  return cx >= 0 && cz >= 0 && cx < grid.width && cz < grid.depth;
}

export function isWalkable(grid: NavGrid, cx: number, cz: number): boolean {
  return inGrid(grid, cx, cz) && grid.walkable[cz * grid.width + cx] === 1;
}

export function setWalkable(grid: NavGrid, cx: number, cz: number, value: boolean): void {
  if (!inGrid(grid, cx, cz)) return;
  grid.walkable[cz * grid.width + cx] = value ? 1 : 0;
}

export function worldToCell(grid: NavGrid, x: number, z: number): GridCell {
  return { cx: Math.floor(x - grid.originX), cz: Math.floor(z - grid.originZ) };
}

/** Centre of a cell in world space. */
export function cellToWorld(grid: NavGrid, cell: GridCell): { x: number; z: number } {
  return { x: grid.originX + cell.cx + 0.5, z: grid.originZ + cell.cz + 0.5 };
}

/** The walkable cell closest to the given one, searching outward in rings. */
export function nearestWalkable(grid: NavGrid, cell: GridCell, maxRadius = 8): GridCell | null {
  if (isWalkable(grid, cell.cx, cell.cz)) return cell;
  for (let r = 1; r <= maxRadius; r++) {
    let best: GridCell | null = null;
    let bestDist = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cell.cx + dx;
        const cz = cell.cz + dz;
        if (!isWalkable(grid, cx, cz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = { cx, cz };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function heuristic(a: GridCell, b: GridCell): number {
  const dx = Math.abs(a.cx - b.cx);
  const dz = Math.abs(a.cz - b.cz);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}

/**
 * A* from one cell to another. Returns the cells from start to goal
 * inclusive, or null when the goal cannot be reached. Start and goal must be
 * walkable.
 */
export function findPath(grid: NavGrid, start: GridCell, goal: GridCell): GridCell[] | null {
  if (!isWalkable(grid, start.cx, start.cz) || !isWalkable(grid, goal.cx, goal.cz)) return null;
  const n = grid.width * grid.depth;
  const idx = (c: GridCell) => c.cz * grid.width + c.cx;
  const startI = idx(start);
  const goalI = idx(goal);
  if (startI === goalI) return [start];

  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // A plain array as the open set is fine at diorama sizes (a few hundred cells).
  const open: number[] = [startI];
  g[startI] = 0;
  f[startI] = heuristic(start, goal);

  while (open.length) {
    let bestPos = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bestPos]]) bestPos = i;
    const current = open[bestPos];
    open[bestPos] = open[open.length - 1];
    open.pop();
    if (current === goalI) {
      const path: GridCell[] = [];
      let c = current;
      while (c !== -1) {
        path.push({ cx: c % grid.width, cz: Math.floor(c / grid.width) });
        c = came[c];
      }
      return path.reverse();
    }
    closed[current] = 1;
    const cx = current % grid.width;
    const cz = Math.floor(current / grid.width);
    for (const [dx, dz, cost] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!isWalkable(grid, nx, nz)) continue;
      // No corner cutting: a diagonal needs both orthogonal neighbours free.
      if (dx !== 0 && dz !== 0 && (!isWalkable(grid, cx + dx, cz) || !isWalkable(grid, cx, cz + dz))) continue;
      const ni = nz * grid.width + nx;
      if (closed[ni]) continue;
      const tentative = g[current] + cost;
      if (tentative < g[ni]) {
        came[ni] = current;
        g[ni] = tentative;
        f[ni] = tentative + heuristic({ cx: nx, cz: nz }, goal);
        if (!open.includes(ni)) open.push(ni);
      }
    }
  }
  return null;
}

/** Drop cells that lie on a straight run so a path has only its turns. */
export function simplifyPath(path: GridCell[]): GridCell[] {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1];
    const b = path[i];
    const c = path[i + 1];
    const d1x = Math.sign(b.cx - a.cx);
    const d1z = Math.sign(b.cz - a.cz);
    const d2x = Math.sign(c.cx - b.cx);
    const d2z = Math.sign(c.cz - b.cz);
    if (d1x !== d2x || d1z !== d2z) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}
