/**
 * Tall pieces (king, queen, bishop) photographed from a low angle lean into the
 * square behind them, away from the camera, and the model often sees a second
 * piece there. These rules find such pairs and either drop the ghost or mark
 * the square for a human check.
 */

/** Which edge of the board the photographer stood at. */
export type CameraSide = "white" | "black" | "a-file" | "h-file";

const CLASSES = ["empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];
const TALL = new Set(["K", "Q", "B"]);

export const TALL_CONFIDENCE = 0.75;
export const GHOST_MAX_CONFIDENCE = 0.6;
export const GHOST_MIN_EMPTY = 0.2;

const FILES = "abcdefgh";

function squareName(index: number): string {
  return `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;
}

/** Index (a8..h1) of the square directly behind `index` as seen from the camera, or null at the edge. */
export function behindIndex(index: number, side: CameraSide): number | null {
  const row = Math.floor(index / 8);
  const col = index % 8;
  // row 0 is rank 8, so "rank + 1" is row - 1.
  const [dr, dc] =
    side === "white" ? [-1, 0] : side === "black" ? [1, 0] : side === "a-file" ? [0, 1] : [0, -1];
  const r = row + dr;
  const c = col + dc;
  if (r < 0 || r > 7 || c < 0 || c > 7) return null;
  return r * 8 + c;
}

function colourOf(symbol: string): "w" | "b" | null {
  if (symbol === "empty") return null;
  return symbol === symbol.toUpperCase() ? "w" : "b";
}

export type TallResolution = {
  symbols: string[];
  checkSquares: string[];
  dropped: string[];
};

export function resolveTallConflicts(
  symbols: readonly string[],
  probabilities: readonly number[][],
  cameraSide: CameraSide,
): TallResolution {
  const out = symbols.slice();
  const check = new Set<string>();
  const dropped: string[] = [];
  const conf = (i: number, symbol: string) => probabilities[i]?.[CLASSES.indexOf(symbol)] ?? 0;

  for (let i = 0; i < 64; i += 1) {
    const front = symbols[i];
    if (!TALL.has(front.toUpperCase())) continue;
    const frontConf = conf(i, front);
    if (frontConf < TALL_CONFIDENCE) continue;
    const b = behindIndex(i, cameraSide);
    if (b === null) continue;
    const back = out[b];
    if (colourOf(back) !== colourOf(front)) continue;
    const backConf = conf(b, back);
    if (backConf >= frontConf) continue;

    const ghostLike =
      backConf < GHOST_MAX_CONFIDENCE && (probabilities[b]?.[0] ?? 0) >= GHOST_MIN_EMPTY;
    const lastKing = back.toUpperCase() === "K" && out.filter((s) => s === back).length <= 1;
    if (ghostLike && !lastKing) {
      out[b] = "empty";
      dropped.push(squareName(b));
    }
    check.add(squareName(b));
  }

  return { symbols: out, checkSquares: [...check], dropped };
}
