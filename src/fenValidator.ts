import { Chess, type Color, type Square } from "chess.js";

export type PieceCode =
  | "wK"
  | "wQ"
  | "wR"
  | "wB"
  | "wN"
  | "wP"
  | "bK"
  | "bQ"
  | "bR"
  | "bB"
  | "bN"
  | "bP";

export type BoardMap = Partial<Record<Square, PieceCode>>;

export type CastlingRights = {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
};

export type EditorSettings = {
  turn: Color;
  castling: CastlingRights;
};

export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const EMPTY_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

const PIECE_TO_FEN: Record<PieceCode, string> = {
  wK: "K",
  wQ: "Q",
  wR: "R",
  wB: "B",
  wN: "N",
  wP: "P",
  bK: "k",
  bQ: "q",
  bR: "r",
  bB: "b",
  bN: "n",
  bP: "p",
};

const FEN_TO_PIECE: Record<string, PieceCode> = {
  K: "wK",
  Q: "wQ",
  R: "wR",
  B: "wB",
  N: "wN",
  P: "wP",
  k: "bK",
  q: "bQ",
  r: "bR",
  b: "bB",
  n: "bN",
  p: "bP",
};

export function buildCastlingString(castling: CastlingRights): string {
  let out = "";
  if (castling.wK) out += "K";
  if (castling.wQ) out += "Q";
  if (castling.bK) out += "k";
  if (castling.bQ) out += "q";
  return out || "-";
}

export function buildFen(board: BoardMap, settings: EditorSettings): string {
  const rankStrings: string[] = [];

  for (const rank of RANKS) {
    let emptyCount = 0;
    let row = "";
    for (const file of FILES) {
      const sq = `${file}${rank}` as Square;
      const piece = board[sq];
      if (piece) {
        if (emptyCount > 0) {
          row += String(emptyCount);
          emptyCount = 0;
        }
        row += PIECE_TO_FEN[piece];
      } else {
        emptyCount += 1;
      }
    }
    if (emptyCount > 0) {
      row += String(emptyCount);
    }
    rankStrings.push(row);
  }

  const placement = rankStrings.join("/");
  const castling = buildCastlingString(settings.castling);
  return `${placement} ${settings.turn} ${castling} - 0 1`;
}

export function parseFenToEditor(fen: string): {
  board: BoardMap;
  settings: EditorSettings;
} | null {
  const trimmed = fen.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const placement = parts[0];
  if (!placement) return null;

  const rows = placement.split("/");
  if (rows.length !== 8) return null;

  const board: BoardMap = {};

  for (let r = 0; r < 8; r += 1) {
    const rank = RANKS[r];
    let fileIndex = 0;
    for (const ch of rows[r]) {
      if (ch >= "1" && ch <= "8") {
        fileIndex += Number(ch);
      } else {
        const piece = FEN_TO_PIECE[ch];
        if (!piece || fileIndex >= 8) return null;
        const sq = `${FILES[fileIndex]}${rank}` as Square;
        board[sq] = piece;
        fileIndex += 1;
      }
    }
    if (fileIndex !== 8) return null;
  }

  const turnPart = parts[1];
  const turn: Color =
    turnPart === "b" ? "b" : turnPart === "w" || !turnPart ? "w" : "w";
  if (turnPart && turnPart !== "w" && turnPart !== "b") {
    return null;
  }

  const castlingPart = parts[2] ?? "-";
  if (castlingPart !== "-" && !/^[KQkq]+$/.test(castlingPart)) {
    return null;
  }

  const castling: CastlingRights = {
    wK: castlingPart.includes("K"),
    wQ: castlingPart.includes("Q"),
    bK: castlingPart.includes("k"),
    bQ: castlingPart.includes("q"),
  };

  return {
    board,
    settings: { turn, castling },
  };
}

export type ValidationResult = {
  valid: boolean;
  error: string | null;
};

export function validateEditorPosition(
  board: BoardMap,
  settings: EditorSettings,
): ValidationResult {
  let whiteKings = 0;
  let blackKings = 0;
  let whitePawns = 0;
  let blackPawns = 0;
  let whitePieces = 0;
  let blackPieces = 0;
  let pawnOnEdgeRank = false;
  let whiteKingSquare: Square | null = null;
  let blackKingSquare: Square | null = null;

  for (const [sq, piece] of Object.entries(board) as [Square, PieceCode][]) {
    if (!piece) continue;
    const rank = sq[1];

    if (piece.startsWith("w")) {
      whitePieces += 1;
      if (piece === "wK") {
        whiteKings += 1;
        whiteKingSquare = sq;
      }
      if (piece === "wP") {
        whitePawns += 1;
        if (rank === "1" || rank === "8") pawnOnEdgeRank = true;
      }
    } else {
      blackPieces += 1;
      if (piece === "bK") {
        blackKings += 1;
        blackKingSquare = sq;
      }
      if (piece === "bP") {
        blackPawns += 1;
        if (rank === "1" || rank === "8") pawnOnEdgeRank = true;
      }
    }
  }

  if (whiteKings !== 1 || blackKings !== 1) {
    return {
      valid: false,
      error: "Position must have exactly one white king and one black king.",
    };
  }

  if (pawnOnEdgeRank) {
    return {
      valid: false,
      error: "Pawns cannot be placed on the first or eighth rank.",
    };
  }

  if (whitePawns > 8 || blackPawns > 8) {
    return {
      valid: false,
      error: "Neither side may have more than 8 pawns.",
    };
  }

  if (whitePieces > 16 || blackPieces > 16) {
    return {
      valid: false,
      error: "Neither side may have more than 16 pieces.",
    };
  }

  const { castling } = settings;
  if (castling.wK && (board.e1 !== "wK" || board.h1 !== "wR")) {
    return {
      valid: false,
      error:
        "White kingside castling requires the white king on e1 and rook on h1.",
    };
  }
  if (castling.wQ && (board.e1 !== "wK" || board.a1 !== "wR")) {
    return {
      valid: false,
      error:
        "White queenside castling requires the white king on e1 and rook on a1.",
    };
  }
  if (castling.bK && (board.e8 !== "bK" || board.h8 !== "bR")) {
    return {
      valid: false,
      error:
        "Black kingside castling requires the black king on e8 and rook on h8.",
    };
  }
  if (castling.bQ && (board.e8 !== "bK" || board.a8 !== "bR")) {
    return {
      valid: false,
      error:
        "Black queenside castling requires the black king on e8 and rook on a8.",
    };
  }

  const fen = buildFen(board, settings);
  const probe = new Chess();
  try {
    probe.load(fen, { skipValidation: true });
  } catch {
    return {
      valid: false,
      error: "Invalid position.",
    };
  }

  const nonMoverColor: Color = settings.turn === "w" ? "b" : "w";
  const nonMoverKingSquare =
    nonMoverColor === "w" ? whiteKingSquare : blackKingSquare;

  if (
    nonMoverKingSquare &&
    probe.isAttacked(nonMoverKingSquare, settings.turn)
  ) {
    return {
      valid: false,
      error: "The side not to move cannot be in check.",
    };
  }

  try {
    const strictGame = new Chess(fen);
    if (!strictGame) {
      return { valid: false, error: "Invalid position." };
    }
  } catch {
    return {
      valid: false,
      error: "Invalid position.",
    };
  }

  return { valid: true, error: null };
}

export function validateFenString(fen: string): ValidationResult {
  const parsed = parseFenToEditor(fen);
  if (!parsed) {
    return { valid: false, error: "Invalid FEN string." };
  }
  return validateEditorPosition(parsed.board, parsed.settings);
}
