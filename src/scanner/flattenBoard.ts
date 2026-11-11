import openCvUrl from "@techstark/opencv-js/dist/opencv.js?url";
import { BOARD_MARGIN, FLATTENED_SIZE } from "./cropSquares";

export type Point2D = {
  x: number;
  y: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CvInstance = any;

// OpenCV is loaded as a classic <script>, not through import(). Bundling its UMD
// file makes the production build wrap the exported promise in an object that
// inherits from Promise without being one, and awaiting that throws
// "Promise.prototype.then called on incompatible receiver". The ready module is
// also kept inside a { cv } box because it can be thenable itself.
type CvBox = { cv: CvInstance };

let cvPromise: Promise<CvBox> | null = null;

function isReady(value: unknown): boolean {
  return Boolean(value) && typeof (value as Record<string, unknown>).Mat === "function";
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Could not load the image tools. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
}

export function loadOpenCv(): Promise<CvBox> {
  if (cvPromise) return cvPromise;

  cvPromise = (async (): Promise<CvBox> => {
    const scope = globalThis as unknown as { cv?: CvInstance };
    if (!scope.cv) await injectScript(openCvUrl);
    const loaded = scope.cv;
    if (!loaded) throw new Error("The image tools did not start.");

    if (isReady(loaded)) return { cv: loaded };
    if (typeof loaded.then === "function") {
      return await new Promise<CvBox>((resolve, reject) => {
        loaded.then((cv: CvInstance) => {
          scope.cv = cv;
          resolve({ cv });
        }, reject);
      });
    }
    return await new Promise<CvBox>((resolve) => {
      loaded.onRuntimeInitialized = () => resolve({ cv: loaded });
    });
  })();

  cvPromise.catch(() => {
    cvPromise = null;
  });

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
  const { cv } = await loadOpenCv();

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
