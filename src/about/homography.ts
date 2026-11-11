export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type Matrix3 = [number, number, number, number, number, number, number, number, number];

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col] || 1e-12;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = m[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Homography H such that H * src[i] ~ dst[i], the same 8-unknown DLT OpenCV's getPerspectiveTransform solves. */
export function homography(src: Quad, dst: Quad): Matrix3 {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function project(h: Matrix3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function lerpQuad(a: Quad, b: Quad, t: number): Quad {
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * t,
    y: p.y + (b[i].y - p.y) * t,
  })) as Quad;
}

export const UNIT_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
