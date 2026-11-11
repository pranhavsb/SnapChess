import type { Point2D } from "./flattenBoard";

export type TrainingMetadata = {
  timestamp: string;
  imageFile: string;
  imageWidth: number;
  imageHeight: number;
  rotationSteps90: number;
  corners: {
    topLeft: Point2D;
    topRight: Point2D;
    bottomRight: Point2D;
    bottomLeft: Point2D;
  };
  fen: string;
};

function formatTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveForTraining(params: {
  photoBlob: Blob;
  photoExtension?: string;
  imageWidth: number;
  imageHeight: number;
  corners: [Point2D, Point2D, Point2D, Point2D];
  rotationSteps90: number;
  fen: string;
}): { baseName: string; metadata: TrainingMetadata } {
  const stamp = formatTimestamp();
  const ext = params.photoExtension || "png";
  const baseName = `snapchess-${stamp}`;
  const imageFile = `${baseName}.${ext}`;
  const jsonFile = `${baseName}.json`;

  const metadata: TrainingMetadata = {
    timestamp: new Date().toISOString(),
    imageFile,
    imageWidth: Math.round(params.imageWidth),
    imageHeight: Math.round(params.imageHeight),
    rotationSteps90: params.rotationSteps90,
    corners: {
      topLeft: {
        x: Math.round(params.corners[0].x * 100) / 100,
        y: Math.round(params.corners[0].y * 100) / 100,
      },
      topRight: {
        x: Math.round(params.corners[1].x * 100) / 100,
        y: Math.round(params.corners[1].y * 100) / 100,
      },
      bottomRight: {
        x: Math.round(params.corners[2].x * 100) / 100,
        y: Math.round(params.corners[2].y * 100) / 100,
      },
      bottomLeft: {
        x: Math.round(params.corners[3].x * 100) / 100,
        y: Math.round(params.corners[3].y * 100) / 100,
      },
    },
    fen: params.fen.trim(),
  };

  triggerDownload(params.photoBlob, imageFile);

  const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], {
    type: "application/json",
  });
  triggerDownload(jsonBlob, jsonFile);

  return { baseName, metadata };
}
