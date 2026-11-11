import * as ort from "onnxruntime-web/wasm";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import type { SquareCrop } from "./cropSquares";
import { decodePlacement, priorFromCounts, type PositionPrior } from "./pieceRules";

export const MODEL_CLASSES = [
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

export type PredictedSymbol = (typeof MODEL_CLASSES)[number];

export type SquarePrediction = {
  square: string;
  symbol: PredictedSymbol;
  confidence: number;
};

export type BoardClassification = {
  fen: string;
  placement: string;
  squares: SquarePrediction[];
  meanConfidence: number;
  /** Squares whose class changed to satisfy piece counts, pawn ranks and game statistics. */
  adjustedSquares: number;
  usedPositionPrior: boolean;
  /** Squares where the model's top class is below UNSURE_PROBABILITY. */
  uncertainSquares: string[];
  /** Too many uncertain squares: the model has probably never seen this board or set. */
  unfamiliarBoard: boolean;
};

const UNSURE_PROBABILITY = 0.6;
// Past this many unsure squares, game statistics would mostly be inventing the
// position (usually something close to the starting setup), so they are skipped.
const UNFAMILIAR_LIMIT = 12;

const INPUT_W = 96;
const INPUT_H = 144;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;
const MODEL_URL = "/models/snapchess_pieces.onnx";
const PRIOR_URL = "/models/position_prior.json";

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let priorPromise: Promise<PositionPrior | null> | null = null;

/** Real-game square statistics; null when the file is missing so scanning still works. */
function getPositionPrior(): Promise<PositionPrior | null> {
  if (priorPromise) return priorPromise;
  priorPromise = (async () => {
    try {
      const response = await fetch(PRIOR_URL);
      if (!response.ok) return null;
      const data = (await response.json()) as { counts?: number[][] };
      return data.counts?.length === 64 ? priorFromCounts(data.counts) : null;
    } catch {
      return null;
    }
  })();
  return priorPromise;
}

export function getClassifierSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    // The bundled build already contains the .mjs glue; only the .wasm binary
    // is fetched. A string prefix here would make ORT import() the .mjs from
    // that folder, which Vite refuses to serve from public/.
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
    ort.env.wasm.numThreads = 1;
    return await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
    });
  })();

  sessionPromise.catch(() => {
    sessionPromise = null;
  });

  return sessionPromise;
}

function cropImageDataToTensor(
  crop: ImageData,
  srcCanvas: HTMLCanvasElement,
  srcCtx: CanvasRenderingContext2D,
  dstCtx: CanvasRenderingContext2D,
): ort.Tensor {
  if (srcCanvas.width !== crop.width || srcCanvas.height !== crop.height) {
    srcCanvas.width = crop.width;
    srcCanvas.height = crop.height;
  }
  srcCtx.putImageData(crop, 0, 0);

  dstCtx.clearRect(0, 0, INPUT_W, INPUT_H);
  dstCtx.drawImage(
    srcCanvas,
    0,
    0,
    crop.width,
    crop.height,
    0,
    0,
    INPUT_W,
    INPUT_H,
  );

  const { data } = dstCtx.getImageData(0, 0, INPUT_W, INPUT_H);
  const planeSize = INPUT_H * INPUT_W;
  const chw = new Float32Array(3 * planeSize);

  for (let i = 0; i < planeSize; i += 1) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;
    chw[i] = (r - MEAN[0]) / STD[0];
    chw[planeSize + i] = (g - MEAN[1]) / STD[1];
    chw[2 * planeSize + i] = (b - MEAN[2]) / STD[2];
  }

  return new ort.Tensor("float32", chw, [1, 3, INPUT_H, INPUT_W]);
}

export function predictionsToPlacement(
  squares: SquarePrediction[],
): string {
  const rankStrings: string[] = [];

  for (let r = 0; r < 8; r += 1) {
    let emptyCount = 0;
    let row = "";
    for (let c = 0; c < 8; c += 1) {
      const sym = squares[r * 8 + c]?.symbol ?? "empty";
      if (sym === "empty") {
        emptyCount += 1;
      } else {
        if (emptyCount > 0) {
          row += String(emptyCount);
          emptyCount = 0;
        }
        row += sym;
      }
    }
    if (emptyCount > 0) {
      row += String(emptyCount);
    }
    rankStrings.push(row);
  }

  return rankStrings.join("/");
}

export async function classifySquares(
  crops: SquareCrop[],
  onProgress?: (done: number, total: number) => void,
): Promise<BoardClassification> {
  if (crops.length !== 64) {
    throw new Error(`Expected 64 square crops, got ${crops.length}.`);
  }

  const [session, prior] = await Promise.all([
    getClassifierSession(),
    getPositionPrior(),
  ]);

  const srcCanvas = document.createElement("canvas");
  const srcCtx = srcCanvas.getContext("2d");
  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = INPUT_W;
  dstCanvas.height = INPUT_H;
  const dstCtx = dstCanvas.getContext("2d", { willReadFrequently: true });

  if (!srcCtx || !dstCtx) {
    throw new Error("Could not initialize preprocessing canvas.");
  }
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "medium";

  const rows: number[][] = [];
  let confidenceSum = 0;

  for (let i = 0; i < crops.length; i += 1) {
    const crop = crops[i];
    const inputTensor = cropImageDataToTensor(
      crop.image,
      srcCanvas,
      srcCtx,
      dstCtx,
    );
    const outputs = await session.run({ input: inputTensor });
    const logits = outputs.logits.data as Float32Array;
    const maxLogit = Math.max(...logits);
    const exps = Array.from(logits, (value) => Math.exp(value - maxLogit));
    const sum = exps.reduce((total, value) => total + value, 0);
    const probs = exps.map((value) => value / sum);
    rows.push(probs);
    confidenceSum += Math.max(...probs);

    if (onProgress && ((i + 1) % 8 === 0 || i === crops.length - 1)) {
      onProgress(i + 1, crops.length);
    }
  }

  const uncertainSquares = crops
    .filter((_, i) => Math.max(...rows[i]) < UNSURE_PROBABILITY)
    .map((crop) => crop.square);
  const unfamiliarBoard = uncertainSquares.length > UNFAMILIAR_LIMIT;
  const usedPrior = unfamiliarBoard ? null : prior;
  const decoded = decodePlacement(rows, usedPrior, !unfamiliarBoard);
  const squares: SquarePrediction[] = decoded.map((symbol, i) => ({
    square: crops[i].square,
    symbol,
    confidence: rows[i][MODEL_CLASSES.indexOf(symbol)] ?? 0,
  }));
  const adjustedSquares = decoded.filter((symbol, i) => {
    const top = rows[i].indexOf(Math.max(...rows[i]));
    return symbol !== MODEL_CLASSES[top];
  }).length;

  const placement = predictionsToPlacement(squares);
  const fen = `${placement} w - - 0 1`;

  return {
    fen,
    placement,
    squares,
    meanConfidence: confidenceSum / crops.length,
    adjustedSquares,
    usedPositionPrior: usedPrior !== null,
    uncertainSquares,
    unfamiliarBoard,
  };
}
