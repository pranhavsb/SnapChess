const MODEL_CLASSES = [
  "empty",
  "P",
  "N",
  "B",
  "R",
  "Q",
  "K",
  "p",
  "n",
  "b",
  "r",
  "q",
  "k",
] as const;

export type DecodedSymbol = (typeof MODEL_CLASSES)[number];

/** Class indexes, matching the ONNX model. */
const EMPTY = 0;
const P = 1;
const N = 2;
const B = 3;
const R = 4;
const Q = 5;
const K = 6;
const p = 7;
const n = 8;
const b = 9;
const r = 10;
const q = 11;
const k = 12;

const WHITE_HOME = [R, N, B, Q, K, B, N, R];
const BLACK_HOME = [r, n, b, q, k, b, n, r];
const WHITE_OFFICERS = [N, B, R];
const BLACK_OFFICERS = [n, b, r];

function darkSquare(index: number): boolean {
  const row = Math.floor(index / 8);
  const col = index % 8;
  // a1 (row 7, col 0) is dark.
  return (row + col) % 2 === 1;
}

function homeClass(index: number): number | null {
  const row = Math.floor(index / 8);
  const col = index % 8;
  if (row === 0) return BLACK_HOME[col];
  if (row === 1) return p;
  if (row === 6) return P;
  if (row === 7) return WHITE_HOME[col];
  return null;
}

function sortedIndexes(probs: number[]): number[] {
  return probs
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .map((item) => item.index);
}

function margin(probs: number[]): number {
  const ranked = [...probs].sort((a, b) => b - a);
  return ranked[0] - ranked[1];
}

function officerGap(probs: number[], ids: number[]): number {
  const ranked = ids.map((id) => probs[id]).sort((a, b) => b - a);
  return ranked[0] - ranked[1];
}

/** 64 rows (a8..h1) of 13 class probabilities taken from real games. */
export type PositionPrior = number[][];

// Statistics only reweight piece types (knight vs bishop, rook vs queen); the
// chance that a square is occupied stays exactly what the model said.
const TYPE_WEIGHT = 0.5;
// Every class keeps at least this share of a square, so rare but legal
// placements (a king on a4) are only nudged, never ruled out.
const PRIOR_FLOOR = 0.002;

export function priorFromCounts(counts: number[][]): PositionPrior {
  return counts.map((row) => {
    const total = row.reduce((sum, value) => sum + value, 0);
    if (total === 0) return new Array<number>(13).fill(1 / 13);
    const raw = row.map((value) => value / total + PRIOR_FLOOR);
    const norm = raw.reduce((sum, value) => sum + value, 0);
    return raw.map((value) => value / norm);
  });
}

function applyPrior(probs: number[], prior: number[]): number[] {
  const occupied = 1 - prior[EMPTY];
  const typed = probs.map((value, cls) =>
    cls === EMPTY ? 0 : value * (prior[cls] / occupied) ** TYPE_WEIGHT,
  );
  // Type statistics only move probability between pieces; the total chance of
  // "some piece is here" stays what the model said.
  const pieceMass = probs.reduce((sum, value, cls) => (cls === EMPTY ? sum : sum + value), 0);
  const typedMass = typed.reduce((sum, value) => sum + value, 0);
  const typeScale = typedMass > 0 ? pieceMass / typedMass : 0;
  return probs.map((value, cls) => (cls === EMPTY ? value : typed[cls] * typeScale));
}

/** Pawns cannot sit on rank 1 or 8. When a prior is given, real-game square statistics reweight each square. */
export function adjustProbs(rows: number[][], prior?: PositionPrior | null): number[][] {
  return rows.map((source, index) => {
    let probs = source.slice();
    const row = Math.floor(index / 8);
    if (row === 0 || row === 7) {
      probs[P] = 0;
      probs[p] = 0;
    }
    if (prior?.[index]) {
      probs = applyPrior(probs, prior[index]);
    }
    return probs;
  });
}

type SideCount = {
  P: number;
  N: number;
  R: number;
  Q: number;
  K: number;
  lightB: number;
  darkB: number;
};

function emptySide(): SideCount {
  return { P: 0, N: 0, R: 0, Q: 0, K: 0, lightB: 0, darkB: 0 };
}

function sideOf(cls: number): "w" | "b" | null {
  if (cls >= P && cls <= K) return "w";
  if (cls >= p && cls <= k) return "b";
  return null;
}

function addCount(side: SideCount, cls: number, index: number): void {
  const kind = cls <= K ? cls : cls - 6;
  if (kind === P) side.P += 1;
  else if (kind === N) side.N += 1;
  else if (kind === R) side.R += 1;
  else if (kind === Q) side.Q += 1;
  else if (kind === K) side.K += 1;
  else if (kind === B) {
    if (darkSquare(index)) side.darkB += 1;
    else side.lightB += 1;
  }
}

function promotionExtras(side: SideCount): number {
  // A second bishop on the same color has to be a promoted pawn.
  return (
    Math.max(0, side.Q - 1) +
    Math.max(0, side.R - 2) +
    Math.max(0, side.N - 2) +
    Math.max(0, side.lightB - 1) +
    Math.max(0, side.darkB - 1)
  );
}

function sideOk(side: SideCount, allowPromotion: boolean): boolean {
  const bishops = side.lightB + side.darkB;
  const extras = promotionExtras(side);
  const total = side.P + side.N + bishops + side.R + side.Q + side.K;
  if (side.K > 1 || side.P > 8 || total > 16) return false;
  if (!allowPromotion && extras > 0) return false;
  return side.P + extras <= 8;
}

function tally(assign: number[]): { white: SideCount; black: SideCount } {
  const white = emptySide();
  const black = emptySide();
  for (let i = 0; i < assign.length; i += 1) {
    const cls = assign[i];
    const side = sideOf(cls);
    if (side === "w") addCount(white, cls, i);
    else if (side === "b") addCount(black, cls, i);
  }
  return { white, black };
}

export function materialOk(assign: number[], allowPromotion = true): boolean {
  const { white, black } = tally(assign);
  return sideOk(white, allowPromotion) && sideOk(black, allowPromotion);
}

function unsure(probs: number[]): boolean {
  if (margin(probs) < 0.12) return true;
  const top = sortedIndexes(probs)[0];
  if (WHITE_OFFICERS.includes(top) && officerGap(probs, WHITE_OFFICERS) < 0.15) {
    return true;
  }
  if (BLACK_OFFICERS.includes(top) && officerGap(probs, BLACK_OFFICERS) < 0.15) {
    return true;
  }
  return false;
}

function tryOrder(probs: number[], index: number, useHomeGuess: boolean): number[] {
  const ranked = sortedIndexes(probs);
  const home = useHomeGuess ? homeClass(index) : null;
  if (home === null) return ranked;
  const top = probs[ranked[0]];
  if (probs[home] >= top * 0.55 && ranked[0] !== home) {
    return [home, ...ranked.filter((cls) => cls !== home)];
  }
  return ranked;
}

/** Same distribution with "empty" removed, for squares the model sees a piece on. */
function withoutEmpty(probs: number[]): number[] {
  const mass = 1 - probs[EMPTY];
  if (mass <= 0) return probs;
  return probs.map((value, cls) => (cls === EMPTY ? 0 : value / mass));
}

function placeBest(
  assign: number[],
  index: number,
  probs: number[],
  locked: boolean[],
  useHomeGuess: boolean,
): void {
  if (locked[index]) return;
  for (const cls of tryOrder(probs, index, useHomeGuess)) {
    assign[index] = cls;
    // The starting set is the default. A promoted extra piece is kept only when
    // this square is very sure, so an unsure rook/knight/bishop loses to the count.
    if (materialOk(assign, false)) return;
    if (probs[cls] >= 0.8 && materialOk(assign, true)) return;
  }
  assign[index] = EMPTY;
}

/**
 * Turn 64 class distributions into one legal-ish placement.
 * Confident squares are fixed first. Unsure squares, mostly rook/knight/bishop
 * mix-ups, take whatever still fits the piece counts.
 */
export function decodePlacement(
  raw: number[][],
  prior?: PositionPrior | null,
  homeGuess = true,
): DecodedSymbol[] {
  const hasPrior = Boolean(prior && prior.length === 64);
  // Whether a square holds a piece is decided by the photo alone. Statistics and
  // piece rules only choose *which* piece; they never fill a square the model sees as empty.
  const occupied = raw.map((p) => 1 - p[EMPTY] > p[EMPTY]);
  const probs = adjustProbs(raw, hasPrior ? prior : null).map((p, i) =>
    occupied[i] ? withoutEmpty(p) : p,
  );
  // Real-game statistics already favour home squares; the hand-made guess is the fallback.
  const useHomeGuess = homeGuess && !hasPrior;
  const assign = new Array<number>(64).fill(EMPTY);
  const locked = occupied.map((isOccupied) => !isOccupied);

  for (const king of [K, k]) {
    let best = -1;
    let bestP = 0;
    for (let i = 0; i < 64; i += 1) {
      if (!occupied[i]) continue;
      const kingP = probs[i][king];
      const top = Math.max(...probs[i]);
      const competitive = kingP === top || top - kingP < 0.2;
      if (competitive && kingP > bestP) {
        bestP = kingP;
        best = i;
      }
    }
    if (best >= 0 && bestP > 0.15) {
      assign[best] = king;
      locked[best] = true;
    }
  }

  const rest = [...Array(64).keys()].filter((i) => !locked[i]);
  const sure = rest.filter((i) => !unsure(probs[i]));
  const weak = rest.filter((i) => unsure(probs[i]));
  const byConfidence = (a: number, b: number) => margin(probs[b]) - margin(probs[a]);
  for (const index of [...sure.sort(byConfidence), ...weak.sort(byConfidence)]) {
    placeBest(assign, index, probs[index], locked, useHomeGuess);
  }

  return assign.map((cls) => MODEL_CLASSES[cls] ?? "empty");
}
