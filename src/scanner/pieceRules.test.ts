import { decodePlacement, priorFromCounts, type DecodedSymbol } from "./pieceRules.ts";

const CLASSES: DecodedSymbol[] = [
  "empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k",
];

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

function squareIndex(square: string): number {
  const col = square.charCodeAt(0) - 97;
  const row = 8 - Number(square[1]);
  return row * 8 + col;
}

/** A probability row with `share` split across the given classes and the rest spread thinly. */
function probsRow(shares: Partial<Record<DecodedSymbol, number>>): number[] {
  const used = Object.values(shares).reduce((sum, value) => sum + (value ?? 0), 0);
  const free = CLASSES.filter((cls) => shares[cls] === undefined).length;
  return CLASSES.map((cls) => shares[cls] ?? (1 - used) / free);
}

/** Board with both kings on their home squares and everything else confidently empty. */
function baseBoard(): number[][] {
  const rows = Array.from({ length: 64 }, () => probsRow({ empty: 0.97 }));
  rows[squareIndex("e1")] = probsRow({ K: 0.97 });
  rows[squareIndex("e8")] = probsRow({ k: 0.97 });
  return rows;
}

/** Synthetic real-game counts: mostly empty, with knights common on g1 and bishops on c4. */
function samplePrior() {
  const counts = Array.from({ length: 64 }, () => {
    const row = new Array<number>(13).fill(1);
    row[0] = 900;
    return row;
  });
  counts[squareIndex("g1")][0] = 500;
  counts[squareIndex("g1")][2] = 450;
  counts[squareIndex("c4")][0] = 700;
  counts[squareIndex("c4")][3] = 250;
  return priorFromCounts(counts);
}

runTest("without a prior the model's top class is kept", () => {
  const rows = baseBoard();
  rows[squareIndex("c4")] = probsRow({ N: 0.5, B: 0.45 });
  const decoded = decodePlacement(rows);
  assertEqual(decoded[squareIndex("c4")], "N", "c4 without prior");
});

runTest("an unsure knight or bishop follows game statistics", () => {
  const rows = baseBoard();
  rows[squareIndex("g1")] = probsRow({ B: 0.5, N: 0.45 });
  rows[squareIndex("c4")] = probsRow({ N: 0.5, B: 0.45 });
  const decoded = decodePlacement(rows, samplePrior());
  assertEqual(decoded[squareIndex("g1")], "N", "g1 with prior");
  assertEqual(decoded[squareIndex("c4")], "B", "c4 with prior");
});

runTest("a clearly seen piece on an unusual square is kept", () => {
  const rows = baseBoard();
  rows[squareIndex("a5")] = probsRow({ N: 0.95 });
  rows[squareIndex("g1")] = probsRow({ B: 0.92 });
  const decoded = decodePlacement(rows, samplePrior());
  assertEqual(decoded[squareIndex("a5")], "N", "knight on a5");
  assertEqual(decoded[squareIndex("g1")], "B", "confident bishop on g1");
});

runTest("statistics do not erase a fairly sure piece on a quiet square", () => {
  const rows = baseBoard();
  rows[squareIndex("d5")] = probsRow({ Q: 0.75, empty: 0.2 });
  const decoded = decodePlacement(rows, samplePrior());
  assertEqual(decoded[squareIndex("d5")], "Q", "queen on d5");
});

runTest("statistics never put a piece on a square the photo shows as empty", () => {
  const rows = baseBoard();
  rows[squareIndex("g1")] = probsRow({ empty: 0.55, N: 0.4 });
  rows[squareIndex("e2")] = probsRow({ empty: 0.52, P: 0.45 });
  const decoded = decodePlacement(rows, samplePrior());
  assertEqual(decoded[squareIndex("g1")], "empty", "g1 stays empty");
  assertEqual(decoded[squareIndex("e2")], "empty", "e2 stays empty");
});

runTest("a missing king is not invented on an empty square", () => {
  const rows = baseBoard();
  rows[squareIndex("e8")] = probsRow({ empty: 0.97 });
  rows[squareIndex("g8")] = probsRow({ empty: 0.7, k: 0.25 });
  const decoded = decodePlacement(rows, samplePrior());
  assertEqual(decoded.includes("k"), false, "no black king placed");
});

runTest("pawns are never placed on the first or last rank", () => {
  const rows = baseBoard();
  rows[squareIndex("b8")] = probsRow({ P: 0.6, N: 0.3 });
  const decoded = decodePlacement(rows, samplePrior());
  assertEqual(decoded[squareIndex("b8")], "N", "b8 pawn replaced");
});
