import { BOARD_MARGIN, FLATTENED_SIZE, SQUARE_SIZE, type SquareCrop } from "./cropSquares.ts";
import type { CameraSide } from "./tallPieces.ts";

/**
 * Tall crops: each square plus the space above it as seen from the camera, so a
 * king or queen whose top leans into the next square is still inside its own
 * crop. Crops are cut from a "camera frame": the flattened board rotated so the
 * edge nearest the camera is at the bottom, which makes "up" in every crop the
 * direction pieces lean.
 *
 * The base square always sits at the same place at the bottom of the crop
 * (SIDE_EXTENSION on each side, BOTTOM_PAD below). No marker is drawn on it:
 * the model would learn the marker, and photos without it would look different.
 * A fixed position is enough for the model to learn which square is meant.
 */

/** Squares of headroom above the base square. Useful range 1.0 to 1.6. */
export const TALL_CROP_EXTENSION = 1.2;
/** Extra width on each side, in squares. */
export const SIDE_EXTENSION = 0.15;
/** Extra height below the base square, in squares. */
export const BOTTOM_PAD = 0.1;

const S = FLATTENED_SIZE;
const M = BOARD_MARGIN;
const Q = SQUARE_SIZE;
const FILES = "abcdefgh";

export type Rect = { x: number; y: number; w: number; h: number };

/** rotationSteps90 used by Flatten for each camera side. */
export const CAMERA_SIDES: { side: CameraSide; steps: number; label: string }[] = [
  { side: "white", steps: 0, label: "White's side" },
  { side: "black", steps: 2, label: "Black's side" },
  { side: "a-file", steps: 1, label: "White's left (a-file)" },
  { side: "h-file", steps: 3, label: "White's right (h-file)" },
];

/**
 * The photo's bottom edge (corners 3 and 4) is nearest the camera. Each step of
 * rotateCorners90CW moves it one edge clockwise in the flattened frame:
 * 0 bottom, 1 left, 2 top, 3 right. With White at the bottom of the flattened
 * board, those are White's side, the a-file, Black's side and the h-file.
 */
export function cameraSideFromRotation(steps: number): CameraSide {
  const k = ((steps % 4) + 4) % 4;
  return (["white", "a-file", "black", "h-file"] as const)[k];
}

export function cameraSideLabel(side: CameraSide): string {
  return CAMERA_SIDES.find((c) => c.side === side)?.label ?? side;
}

/** Canvas transform (a, b, c, d, e, f) from the flattened frame to the camera frame. */
export function cameraTransform(side: CameraSide): [number, number, number, number, number, number] {
  if (side === "a-file") return [0, -1, 1, 0, 0, S];
  if (side === "black") return [-1, 0, 0, -1, S, S];
  if (side === "h-file") return [0, 1, -1, 0, S, 0];
  return [1, 0, 0, 1, 0, 0];
}

export function flatToCamera(side: CameraSide, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = cameraTransform(side);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function cameraToFlat(side: CameraSide, x: number, y: number): { x: number; y: number } {
  if (side === "a-file") return { x: S - y, y: x };
  if (side === "black") return { x: S - x, y: S - y };
  if (side === "h-file") return { x: y, y: S - x };
  return { x, y };
}

/** a8..h1 index of the board square shown in camera-frame cell (row, col). */
export function cameraCellToIndex(side: CameraSide, row: number, col: number): number {
  const p = cameraToFlat(side, M + (col + 0.5) * Q, M + (row + 0.5) * Q);
  return Math.floor((p.y - M) / Q) * 8 + Math.floor((p.x - M) / Q);
}

export function indexToSquare(index: number): string {
  return `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;
}

export function tallCropRect(row: number, col: number, extension = TALL_CROP_EXTENSION): Rect {
  const x0 = M + col * Q;
  const y0 = M + row * Q;
  const top = Math.round(y0 - extension * Q);
  const bottom = Math.round(y0 + Q + BOTTOM_PAD * Q);
  const left = Math.round(x0 - SIDE_EXTENSION * Q);
  return { x: left, y: top, w: Math.round((1 + 2 * SIDE_EXTENSION) * Q), h: bottom - top };
}

export function cropGeometryTag(extension = TALL_CROP_EXTENSION): string {
  return `tall-${extension}`;
}

function rectToFlat(side: CameraSide, r: Rect): Rect {
  const a = cameraToFlat(side, r.x, r.y);
  const b = cameraToFlat(side, r.x + r.w, r.y + r.h);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Tall crop and base square of every square, in flattened-frame pixels (a8..h1), for the debug overlay. */
export function tallCropFlatRects(
  side: CameraSide,
  extension = TALL_CROP_EXTENSION,
): { square: string; tall: Rect; base: Rect }[] {
  const out: { square: string; tall: Rect; base: Rect }[] = new Array(64);
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const index = cameraCellToIndex(side, row, col);
      out[index] = {
        square: indexToSquare(index),
        tall: rectToFlat(side, tallCropRect(row, col, extension)),
        base: rectToFlat(side, { x: M + col * Q, y: M + row * Q, w: Q, h: Q }),
      };
    }
  }
  return out;
}

/** The flattened board rotated so the camera edge is at the bottom. */
export function buildCameraFrame(flattened: HTMLCanvasElement, side: CameraSide): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D context for the camera frame.");
  ctx.setTransform(...cameraTransform(side));
  ctx.drawImage(flattened, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/** Tall crops and tight 100x100 squares, both in camera frame, ordered a8..h1. */
export function tallCrops(
  flattened: HTMLCanvasElement,
  side: CameraSide,
  extension = TALL_CROP_EXTENSION,
): { tall: SquareCrop[]; tight: SquareCrop[] } {
  const frame = buildCameraFrame(flattened, side);
  const frameCtx = frame.getContext("2d");
  if (!frameCtx) throw new Error("Could not read the camera frame.");
  const tall: SquareCrop[] = new Array(64);
  const tight: SquareCrop[] = new Array(64);
  const cell = document.createElement("canvas");
  const cellCtx = cell.getContext("2d", { willReadFrequently: true });
  if (!cellCtx) throw new Error("Could not create crop canvas.");

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const index = cameraCellToIndex(side, row, col);
      const square = indexToSquare(index);
      const r = tallCropRect(row, col, extension);
      cell.width = r.w;
      cell.height = r.h;
      // Anything outside the warped image stays black.
      cellCtx.fillStyle = "#000";
      cellCtx.fillRect(0, 0, r.w, r.h);
      cellCtx.drawImage(frame, -r.x, -r.y);
      tall[index] = { square, image: cellCtx.getImageData(0, 0, r.w, r.h) };
      tight[index] = {
        square,
        image: frameCtx.getImageData(M + col * Q, M + row * Q, Q, Q),
      };
    }
  }
  return { tall, tight };
}
