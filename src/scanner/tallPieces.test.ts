import { behindIndex, resolveTallConflicts, type CameraSide } from "./tallPieces.ts";
import {
  cameraCellToIndex,
  cameraToFlat,
  flatToCamera,
  indexToSquare,
  tallCropFlatRects,
  tallCropRect,
} from "./tallCrops.ts";

const CLASSES = ["empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  console.log(`PASS: ${name}`);
}

function idx(square: string): number {
  return (8 - Number(square[1])) * 8 + (square.charCodeAt(0) - 97);
}

/** Empty board with the given squares set to symbol / probability rows. */
function board(cells: Record<string, [string, Record<string, number>]>) {
  const symbols = new Array<string>(64).fill("empty");
  const probs = Array.from({ length: 64 }, () => CLASSES.map((c) => (c === "empty" ? 0.99 : 0.01 / 12)));
  for (const [sq, [symbol, shares]] of Object.entries(cells)) {
    symbols[idx(sq)] = symbol;
    const used = Object.values(shares).reduce((s, v) => s + (v ?? 0), 0);
    const free = CLASSES.filter((c) => shares[c] === undefined).length;
    probs[idx(sq)] = CLASSES.map((c) => shares[c] ?? (1 - used) / free);
  }
  return { symbols, probs };
}

runTest("behind square follows the camera side", () => {
  assertEqual(indexToSquare(behindIndex(idx("e4"), "white")!), "e5", "white side");
  assertEqual(indexToSquare(behindIndex(idx("e4"), "black")!), "e3", "black side");
  assertEqual(indexToSquare(behindIndex(idx("e4"), "a-file")!), "f4", "a-file side");
  assertEqual(indexToSquare(behindIndex(idx("e4"), "h-file")!), "d4", "h-file side");
  assertEqual(behindIndex(idx("e8"), "white"), null, "no square behind the far rank");
});

runTest("a weak same-colour ghost behind a sure queen is dropped", () => {
  const { symbols, probs } = board({
    d1: ["Q", { Q: 0.9 }],
    d2: ["B", { B: 0.45, empty: 0.35 }],
  });
  const res = resolveTallConflicts(symbols, probs, "white");
  assertEqual(res.symbols[idx("d2")], "empty", "ghost removed");
  assertEqual(res.dropped, ["d2"], "dropped list");
  assertEqual(res.checkSquares, ["d2"], "dropped square is marked for checking");
});

runTest("a fairly sure piece behind is only marked for checking", () => {
  const { symbols, probs } = board({
    e1: ["K", { K: 0.95 }],
    e2: ["P", { P: 0.7, empty: 0.25 }],
  });
  const res = resolveTallConflicts(symbols, probs, "white");
  assertEqual(res.symbols[idx("e2")], "P", "pawn kept");
  assertEqual(res.checkSquares, ["e2"], "pawn marked");
});

runTest("opposite colour or a short piece in front is left alone", () => {
  const a = board({ d1: ["Q", { Q: 0.9 }], d2: ["b", { b: 0.4, empty: 0.4 }] });
  assertEqual(resolveTallConflicts(a.symbols, a.probs, "white").checkSquares, [], "other colour");
  const b = board({ d1: ["N", { N: 0.95 }], d2: ["B", { B: 0.4, empty: 0.4 }] });
  assertEqual(resolveTallConflicts(b.symbols, b.probs, "white").checkSquares, [], "knight is short");
  const c = board({ d1: ["Q", { Q: 0.7 }], d2: ["B", { B: 0.4, empty: 0.4 }] });
  assertEqual(resolveTallConflicts(c.symbols, c.probs, "white").checkSquares, [], "queen not sure enough");
});

runTest("the direction depends on the camera side", () => {
  const { symbols, probs } = board({
    d4: ["q", { q: 0.9 }],
    c4: ["b", { b: 0.4, empty: 0.4 }],
  });
  assertEqual(resolveTallConflicts(symbols, probs, "white").checkSquares, [], "white side looks at d5");
  assertEqual(resolveTallConflicts(symbols, probs, "h-file").dropped, ["c4"], "h-file side looks at c4");
});

runTest("the only king of a colour is never dropped", () => {
  const { symbols, probs } = board({
    d1: ["Q", { Q: 0.9 }],
    d2: ["K", { K: 0.4, empty: 0.4 }],
  });
  const res = resolveTallConflicts(symbols, probs, "white");
  assertEqual(res.symbols[idx("d2")], "K", "king kept");
  assertEqual(res.checkSquares, ["d2"], "king marked");
});

const SIDES: CameraSide[] = ["white", "black", "a-file", "h-file"];

runTest("camera frame transforms invert each other", () => {
  for (const side of SIDES) {
    for (const [x, y] of [[0, 0], [130, 870], [1000, 250]]) {
      const back = flatToCamera(side, ...(Object.values(cameraToFlat(side, x, y)) as [number, number]));
      assertEqual([back.x, back.y], [x, y], `${side} round trip`);
    }
  }
});

runTest("the camera edge of the board is at the bottom of the camera frame", () => {
  // The bottom camera row must hold the rank or file nearest the camera.
  const nearest: Record<CameraSide, string[]> = {
    white: ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"],
    black: ["h8", "g8", "f8", "e8", "d8", "c8", "b8", "a8"],
    "a-file": ["a8", "a7", "a6", "a5", "a4", "a3", "a2", "a1"],
    "h-file": ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"],
  };
  for (const side of SIDES) {
    const row = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => indexToSquare(cameraCellToIndex(side, 7, c)));
    assertEqual(row, nearest[side], side);
  }
});

runTest("tall crop keeps the base square at a fixed spot near the bottom", () => {
  const r = tallCropRect(7, 0, 1.2);
  assertEqual(r, { x: 85, y: 680, w: 130, h: 230 }, "a1 from White's side");
  const rects = tallCropFlatRects("black", 1.2);
  // From Black's side pieces lean towards rank 1, i.e. downwards in the flattened frame.
  assertEqual(rects[idx("e4")].base, { x: 500, y: 500, w: 100, h: 100 }, "base square");
  assertEqual(rects[idx("e4")].tall, { x: 485, y: 490, w: 130, h: 230 }, "tall crop extends down");
});
