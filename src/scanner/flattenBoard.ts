import { BOARD_MARGIN, FLATTENED_SIZE } from "./cropSquares";

export type Point2D = {
  x: number;
  y: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvInstance = any;

let cvPromise: Promise<CvInstance> | null = null;

export function loadOpenCv(): Promise<CvInstance> {
  if (cvPromise) return cvPromise;

  cvPromise = (async () => {
    const mod = await import("@techstark/opencv-js");
    const raw = (mod as { default?: unknown }).default ?? mod;

    if (raw instanceof Promise) {
      return await raw;
    }

    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.Mat === "function") {
      return candidate;
    }

    if (
      candidate.cv &&
      typeof (candidate.cv as Record<string, unknown>).Mat === "function"
    ) {
      return candidate.cv;
    }

    return await new Promise<CvInstance>((resolve) => {
      candidate.onRuntimeInitialized = () => {
        resolve((candidate.cv as CvInstance) ?? candidate);
      };
    });
  })();

  return cvPromise;
}

export function rotateCorners90CW(
  corners: [Point2D, Point2D, Point2D, Point2D],
): [Point2D, Point2D, Point2D, Point2D] {
  // Rotating the destination board 90 degrees clockwise means:
  // new top-left is old bottom-left (index 3)
  // new top-right is old top-left (index 0)
  // new bottom-right is old top-right (index 1)
  // new bottom-left is old bottom-right (index 2)
  return [corners[3], corners[0], corners[1], corners[2]];
}

export async function flattenBoardToCanvas(
  source: HTMLCanvasElement,
  corners: [Point2D, Point2D, Point2D, Point2D],
  rotationSteps90 = 0,
  targetCanvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const cv = await loadOpenCv();

  let ordered: [Point2D, Point2D, Point2D, Point2D] = [
    corners[0],
    corners[1],
    corners[2],
    corners[3],
  ];

  const steps = ((rotationSteps90 % 4) + 4) % 4;
  for (let i = 0; i < steps; i += 1) {
    ordered = rotateCorners90CW(ordered);
  }

  const outCanvas = targetCanvas ?? document.createElement("canvas");
  outCanvas.width = FLATTENED_SIZE;
  outCanvas.height = FLATTENED_SIZE;

  const minCoord = BOARD_MARGIN;
  const maxCoord = FLATTENED_SIZE - BOARD_MARGIN;

  const MAX_SIDE = 1500;
  const maxDim = Math.max(source.width, source.height);
  let warpSource: HTMLCanvasElement = source;
  let scale = 1;
  if (maxDim > MAX_SIDE) {
    scale = MAX_SIDE / maxDim;
    const scaledCanvas = document.createElement("canvas");
    scaledCanvas.width = Math.round(source.width * scale);
    scaledCanvas.height = Math.round(source.height * scale);
    const sCtx = scaledCanvas.getContext("2d");
    if (sCtx) {
      sCtx.drawImage(source, 0, 0, scaledCanvas.width, scaledCanvas.height);
      warpSource = scaledCanvas;
    } else {
      scale = 1;
    }
  }

  const srcMat = cv.imread(warpSource);
  const dstMat = new cv.Mat();

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ordered[0].x * scale,
    ordered[0].y * scale,
    ordered[1].x * scale,
    ordered[1].y * scale,
    ordered[2].x * scale,
    ordered[2].y * scale,
    ordered[3].x * scale,
    ordered[3].y * scale,
  ]);

  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    minCoord,
    minCoord,
    maxCoord,
    minCoord,
    maxCoord,
    maxCoord,
    minCoord,
    maxCoord,
  ]);

  const transform = cv.getPerspectiveTransform(srcTri, dstTri);
  const dsize = new cv.Size(FLATTENED_SIZE, FLATTENED_SIZE);

  cv.warpPerspective(
    srcMat,
    dstMat,
    transform,
    dsize,
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(242, 238, 227, 255),
  );

  cv.imshow(outCanvas, dstMat);

  srcMat.delete();
  dstMat.delete();
  srcTri.delete();
  dstTri.delete();
  transform.delete();

  return outCanvas;
}
