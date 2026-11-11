export type SquareCrop = {
  square: string;
  image: ImageData;
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

export const FLATTENED_SIZE = 1000;
export const BOARD_MARGIN = 100;
export const SQUARE_SIZE = 100;
export const EXTRA_TOP = 50;

export function cropSquares(canvas: HTMLCanvasElement): SquareCrop[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not acquire 2D context from flattened canvas.");
  }

  const crops: SquareCrop[] = [];

  for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
    const rank = RANKS[rowIndex];
    for (let colIndex = 0; colIndex < 8; colIndex += 1) {
      const file = FILES[colIndex];
      const square = `${file}${rank}`;

      const x = BOARD_MARGIN + colIndex * SQUARE_SIZE;
      const y = BOARD_MARGIN + rowIndex * SQUARE_SIZE - EXTRA_TOP;

      const image = ctx.getImageData(x, y, SQUARE_SIZE, SQUARE_SIZE + EXTRA_TOP);
      crops.push({ square, image });
    }
  }

  return crops;
}
