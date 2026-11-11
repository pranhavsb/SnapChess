// Hand-drawn piece silhouettes on a 100x100 box, origin top-left, base at y=92.
export const SILHOUETTE_PATHS: string[] = [
  // pawn
  "M50 14a13 13 0 1 1 0 26a13 13 0 1 1 0-26Z M40 42h20l-3 6c6 4 9 12 10 26h-34c1-14 4-22 10-26Z M24 78h52v14h-52Z",
  // rook
  "M26 12h10v8h8v-8h12v8h8v-8h10v20l-8 6v34h-32v-34l-8-6Z M22 76h56v16h-56Z",
  // knight
  "M34 92h44c-2-22-4-40-10-54c-4-10-12-20-24-24l-2 8c-6 2-14 10-20 22c-2 6 2 10 8 8l10-4c2 6-4 14-10 20c-4 6-2 14 4 24Z",
  // bishop
  "M50 6a6 6 0 1 1 0 12a6 6 0 1 1 0-12Z M50 18c12 10 18 22 16 34c-1 8-8 14-16 14s-15-6-16-14c-2-12 4-24 16-34Z M38 68h24l4 8h-32Z M24 80h52v12h-52Z",
  // queen
  "M18 26l10 4l6-14l10 12l6-16l6 16l10-12l6 14l10-4l-8 44h-48Z M22 76h56v16h-56Z",
  // king
  "M46 2h8v8h8v8h-8v8h-8v-8h-8v-8h8Z M50 28c16 0 26 10 24 24l-6 18h-36l-6-18c-2-14 8-24 24-24Z M24 76h52v16h-52Z",
];
