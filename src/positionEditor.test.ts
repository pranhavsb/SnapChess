import {
  buildFen,
  parseFenToEditor,
  STARTING_FEN,
  validateEditorPosition,
  validateFenString,
  type BoardMap,
  type EditorSettings,
} from "./fenValidator.ts";

const NO_CASTLING = { wK: false, wQ: false, bK: false, bQ: false };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  console.log(`PASS: ${name}`);
}

// 1. Starting position
runTest("builds and validates the starting position", () => {
  const parsed = parseFenToEditor(STARTING_FEN);
  assert(parsed !== null, "Starting FEN should parse");
  const built = buildFen(parsed.board, parsed.settings);
  assertEqual(built, STARTING_FEN, "Built FEN should match STARTING_FEN");

  const validation = validateEditorPosition(parsed.board, parsed.settings);
  assertEqual(validation.valid, true, "Starting position should be valid");
  assertEqual(validation.error, null, "Starting position error should be null");
});

// 2. Two kings only
runTest("builds and validates a position with two kings only", () => {
  const board: BoardMap = { e1: "wK", e8: "bK" };
  const settings: EditorSettings = { turn: "w", castling: NO_CASTLING };

  const fen = buildFen(board, settings);
  assertEqual(
    fen,
    "4k3/8/8/8/8/8/8/4K3 w - - 0 1",
    "Two kings FEN should match",
  );

  const validation = validateEditorPosition(board, settings);
  assertEqual(validation.valid, true, "Two kings position should be valid");
  assertEqual(validation.error, null, "Two kings error should be null");
});

// 3. Missing king
runTest("rejects a position with a missing king", () => {
  const board: BoardMap = { e1: "wK" };
  const settings: EditorSettings = { turn: "w", castling: NO_CASTLING };

  const validation = validateEditorPosition(board, settings);
  assertEqual(validation.valid, false, "Missing king should be invalid");
  assert(
    (validation.error ?? "").toLowerCase().includes("white king and one black king"),
    "Error should mention both kings",
  );
});

// 4. Pawn on rank 8
runTest("rejects a pawn on rank 8 (or rank 1)", () => {
  const board: BoardMap = { e1: "wK", e8: "bK", a8: "wP" };
  const settings: EditorSettings = { turn: "w", castling: NO_CASTLING };

  const validation = validateEditorPosition(board, settings);
  assertEqual(validation.valid, false, "Pawn on rank 8 should be invalid");
  assert(
    (validation.error ?? "").toLowerCase().includes("first or eighth rank"),
    "Error should mention first or eighth rank",
  );
});

// 5. Side not to move in check
runTest("rejects when the side not to move is in check", () => {
  const board: BoardMap = { e1: "wK", e2: "wR", e8: "bK" };
  const settings: EditorSettings = { turn: "w", castling: NO_CASTLING };

  const validation = validateEditorPosition(board, settings);
  assertEqual(
    validation.valid,
    false,
    "Side not to move in check should be invalid",
  );
  assert(
    (validation.error ?? "")
      .toLowerCase()
      .includes("side not to move cannot be in check"),
    "Error should mention side not to move in check",
  );
});

// 6. Castling ticked without king/rook on starting squares
runTest("rejects castling rights when king or rook is off start square", () => {
  const board: BoardMap = { e1: "wK", h2: "wR", e8: "bK" };
  const settings: EditorSettings = {
    turn: "w",
    castling: { wK: true, wQ: false, bK: false, bQ: false },
  };

  const validation = validateEditorPosition(board, settings);
  assertEqual(validation.valid, false, "Invalid castling should be rejected");
  assert(
    (validation.error ?? "").toLowerCase().includes("castling requires"),
    "Error should mention castling requirement",
  );
});

// 7. More than 8 pawns
runTest("rejects more than 8 pawns for one side", () => {
  const ninePawnsFen = "4k3/8/8/8/8/P7/PPPPPPPP/4K3 w - - 0 1";
  const result = validateFenString(ninePawnsFen);
  assertEqual(result.valid, false, "9 pawns should be invalid");
  assert(
    (result.error ?? "").toLowerCase().includes("more than 8 pawns"),
    "Error should mention more than 8 pawns",
  );
});
