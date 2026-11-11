import type { BoardMap, CastlingRights, PieceCode } from "../fenValidator";
import type { LabelColour, LabelPiece } from "./labelSync";

export type SquareValue = PieceCode | "empty";
export type LabelState = "unset" | "guessed" | "check" | "confirmed";
export type SquareLabel = { value: SquareValue | null; state: LabelState };
export type Labels = Record<string, SquareLabel>;

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

/** a8..h1, the visual order of the flattened board with White at the bottom. */
export const SQUARES_A8_H1: string[] = RANKS.flatMap((rank) =>
  FILES.map((file) => `${file}${rank}`),
);

const START_ROWS = ["rnbqkbnr", "pppppppp", "", "", "", "", "PPPPPPPP", "RNBQKBNR"];

export function emptyLabels(): Labels {
  const out: Labels = {};
  for (const sq of SQUARES_A8_H1) out[sq] = { value: null, state: "unset" };
  return out;
}

/** FEN letter ("N", "p") or "empty" to a square value. */
export function symbolToValue(symbol: string): SquareValue {
  if (symbol === "empty") return "empty";
  const colour = symbol === symbol.toUpperCase() ? "w" : "b";
  return `${colour}${symbol.toUpperCase()}` as PieceCode;
}

export function valueToSymbol(value: SquareValue): string {
  if (value === "empty") return "empty";
  return value[0] === "w" ? value[1] : value[1].toLowerCase();
}

export function valueColour(value: SquareValue): LabelColour {
  return value === "empty" ? "empty" : (value[0] as "w" | "b");
}

export function valuePiece(value: SquareValue): LabelPiece | null {
  return value === "empty" ? null : (value[1] as LabelPiece);
}

export function startingValues(): Record<string, SquareValue> {
  const out: Record<string, SquareValue> = {};
  SQUARES_A8_H1.forEach((sq, i) => {
    const ch = START_ROWS[Math.floor(i / 8)][i % 8];
    out[sq] = ch ? symbolToValue(ch) : "empty";
  });
  return out;
}

export function labelsToBoard(labels: Labels): BoardMap {
  const board: BoardMap = {};
  for (const sq of SQUARES_A8_H1) {
    const v = labels[sq]?.value;
    if (v && v !== "empty") board[sq as keyof BoardMap] = v;
  }
  return board;
}

/** Castling is assumed available while king and rook still stand on their home squares. */
export function inferCastling(board: BoardMap): CastlingRights {
  return {
    wK: board.e1 === "wK" && board.h1 === "wR",
    wQ: board.e1 === "wK" && board.a1 === "wR",
    bK: board.e8 === "bK" && board.h8 === "bR",
    bQ: board.e8 === "bK" && board.a8 === "bR",
  };
}
