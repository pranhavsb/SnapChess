import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Chess } from "chess.js";
import {
  BOARD_MARGIN,
  cropSquares,
  FLATTENED_SIZE,
  SQUARE_SIZE,
  type SquareCrop,
} from "./scanner/cropSquares";
import {
  flattenBoardToCanvas,
  type Point2D,
} from "./scanner/flattenBoard";
import {
  classifySquares,
  getModelInfo,
  type BoardClassification,
  type SquarePrediction,
} from "./scanner/classifyBoard";
import {
  CAMERA_SIDES,
  TALL_CROP_EXTENSION,
  cameraSideFromRotation,
  cameraSideLabel,
  cropGeometryTag,
  tallCropFlatRects,
  tallCrops,
} from "./scanner/tallCrops";
import type { CameraSide } from "./scanner/tallPieces";
import {
  buildFen,
  validateEditorPosition,
  type CastlingRights,
} from "./fenValidator";
import { saveForTraining } from "./scanner/trainingExport";
import {
  SQUARES_A8_H1,
  emptyLabels,
  inferCastling,
  labelsToBoard,
  startingValues,
  symbolToValue,
  valueColour,
  valuePiece,
  type LabelState,
  type Labels,
  type SquareValue,
} from "./scanner/labels";
import {
  enqueue,
  getShareConsent,
  getSyncStatus,
  isSharing,
  setShareConsent,
  subscribeSyncStatus,
  type CornerPoints,
  type QueueItem,
  type ScanLabelRow,
} from "./scanner/labelSync";

const MIN_IMAGE_DIMENSION = 200;
const MAGNIFIER_SIZE = 120;
const MAGNIFIER_ZOOM = 2.5;

type ScanStep = "corners" | "flattened";

const PIECE_KEYS: Record<string, string> = {
  k: "K",
  q: "Q",
  r: "R",
  b: "B",
  n: "N",
  p: "P",
};

const PICKER_PIECES = [
  ["K", "King"],
  ["Q", "Queen"],
  ["R", "Rook"],
  ["B", "Bishop"],
  ["N", "Knight"],
  ["P", "Pawn"],
] as const;

const STATE_WORDS: Record<LabelState, string> = {
  unset: "not set",
  guessed: "guess",
  check: "check",
  confirmed: "confirmed",
};

/** Everything uploaded with the labels of one flattened board. */
type BoardSession = {
  boardId: string;
  boardCanvas: HTMLCanvasElement;
  tallCrops: Map<string, ImageData>;
  tightCrops: Map<string, ImageData>;
  cropGeometry: string;
  cropExtension: number;
  cameraSide: CameraSide;
  cornerPoints: CornerPoints;
  uploaded: Set<string>;
};

function imageDataToBlob(image: ImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  return canvasToBlob(canvas);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode image."));
    }, "image/png");
  });
}

const DEBUG_VIEW =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "1";

function fenLoadError(fen: string): string | null {
  try {
    new Chess(fen);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "This position cannot be loaded.";
  }
}

type ScanBoardProps = {
  onBackHome: () => void;
  onOpenInEditor?: (fen: string) => void;
  onPlayFromHere?: (fen: string) => void;
};

function SquareThumb({
  crop,
  prediction,
}: {
  crop: SquareCrop;
  prediction?: SquarePrediction;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.width = crop.image.width;
    el.height = crop.image.height;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(crop.image, 0, 0);
  }, [crop]);

  const pieceText =
    prediction && prediction.symbol !== "empty" ? ` · ${prediction.symbol}` : "";

  return (
    <div className="crop-cell">
      <canvas ref={canvasRef} className="crop-canvas" />
      <span className="crop-label">
        {crop.square}
        {pieceText}
      </span>
    </div>
  );
}

export function ScanBoard({
  onBackHome,
  onOpenInEditor,
  onPlayFromHere,
}: ScanBoardProps) {
  const takePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const uploadPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const flattenedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawFlattenedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);

  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoExt, setPhotoExt] = useState<string>("png");
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const [corners, setCorners] = useState<Point2D[]>([]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragPointerCss, setDragPointerCss] = useState<Point2D | null>(null);

  const [step, setStep] = useState<ScanStep>("corners");
  const [isFlattening, setIsFlattening] = useState<boolean>(false);
  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [classifyProgress, setClassifyProgress] = useState<number>(0);
  const [classification, setClassification] =
    useState<BoardClassification | null>(null);
  const [rotationSteps90, setRotationSteps90] = useState<number>(0);
  const [showSquares, setShowSquares] = useState<boolean>(false);
  const [crops, setCrops] = useState<SquareCrop[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [labels, setLabels] = useState<Labels>(emptyLabels);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [pendingColour, setPendingColour] = useState<"w" | "b" | null>(null);
  const [turn, setTurn] = useState<"w" | "b">("w");
  const [castlingOverride, setCastlingOverride] =
    useState<CastlingRights | null>(null);
  const [sharing, setSharing] = useState<boolean>(getShareConsent);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const boardSessionRef = useRef<BoardSession | null>(null);
  const squareButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const labelBoard = labelsToBoard(labels);
  const castling = castlingOverride ?? inferCastling(labelBoard);
  const liveFen = buildFen(labelBoard, { turn, castling });
  const positionWarning = validateEditorPosition(labelBoard, {
    turn,
    castling,
  }).error;
  const loadError = fenLoadError(liveFen);
  const selectedValue = selectedSquare ? labels[selectedSquare].value : null;
  const pickerColour: "w" | "b" | null =
    pendingColour ??
    (selectedValue && selectedValue !== "empty"
      ? (selectedValue[0] as "w" | "b")
      : null);
  const confirmedCount = SQUARES_A8_H1.filter(
    (sq) => labels[sq].state === "confirmed",
  ).length;

  function resetLabelling(): void {
    setLabels(emptyLabels());
    setSelectedSquare(null);
    setPendingColour(null);
    setTurn("w");
    setCastlingOverride(null);
  }

  function modelGuessFor(square: string): SquarePrediction | undefined {
    return classification?.squares.find((p) => p.square === square);
  }

  async function buildQueueItems(
    updates: [string, SquareValue][],
  ): Promise<QueueItem[]> {
    const session = boardSessionRef.current;
    if (!session || !isSharing()) return [];
    const items: QueueItem[] = [];
    const boardPath = `${session.boardId}/board.png`;
    if (!session.uploaded.has("board")) {
      session.uploaded.add("board");
      items.push({
        kind: "file",
        path: boardPath,
        blob: await canvasToBlob(session.boardCanvas),
        contentType: "image/png",
      });
    }
    const rows: QueueItem[] = [];
    for (const [square, value] of updates) {
      const tallPath = `${session.boardId}/${square}.png`;
      const tightPath = `${session.boardId}/${square}_tight.png`;
      if (!session.uploaded.has(square)) {
        session.uploaded.add(square);
        const tall = session.tallCrops.get(square);
        const tight = session.tightCrops.get(square);
        if (tall) {
          items.push({
            kind: "file",
            path: tallPath,
            blob: await imageDataToBlob(tall),
            contentType: "image/png",
          });
        }
        if (tight) {
          items.push({
            kind: "file",
            path: tightPath,
            blob: await imageDataToBlob(tight),
            contentType: "image/png",
          });
        }
      }
      const guess = modelGuessFor(square);
      const guessValue = guess ? symbolToValue(guess.symbol) : null;
      const row: ScanLabelRow = {
        id: crypto.randomUUID(),
        board_id: session.boardId,
        square,
        colour: valueColour(value),
        piece: valuePiece(value),
        source:
          guessValue === null
            ? "user_manual"
            : guessValue === value
              ? "model_guess_confirmed"
              : "user_corrected",
        model_guess: guess ? guess.symbol : null,
        model_version: classification?.modelVersion ?? "unversioned",
        model_confidence: guess ? guess.confidence : null,
        crop_image_path: tallPath,
        tight_crop_path: tightPath,
        full_board_image_path: boardPath,
        corner_points: session.cornerPoints,
        camera_side: session.cameraSide,
        crop_geometry: session.cropGeometry,
        camera_angle_estimate: null,
        board_style_tag: null,
      };
      rows.push({ kind: "row", row });
    }
    return [...items, ...rows];
  }

  function confirmSquares(updates: [string, SquareValue][]): void {
    if (updates.length === 0) return;
    setLabels((prev) => {
      const next = { ...prev };
      for (const [square, value] of updates) {
        next[square] = { value, state: "confirmed" };
      }
      return next;
    });
    void buildQueueItems(updates)
      .then((items) => enqueue(items))
      .catch((err) => console.warn("Could not queue scan labels.", err));
  }

  function chooseValue(square: string, value: SquareValue): void {
    setPendingColour(null);
    confirmSquares([[square, value]]);
  }

  function handleConfirmAll(): void {
    const updates: [string, SquareValue][] = [];
    for (const square of SQUARES_A8_H1) {
      const label = labels[square];
      if (label.state === "confirmed") continue;
      updates.push([square, label.value ?? "empty"]);
    }
    confirmSquares(updates);
  }

  function handleFillStart(): void {
    const start = startingValues();
    setLabels((prev) => {
      const next = { ...prev };
      for (const square of SQUARES_A8_H1) {
        if (next[square].state === "confirmed") continue;
        next[square] = { value: start[square], state: "guessed" };
      }
      return next;
    });
  }

  function handleToggleCastling(key: keyof CastlingRights): void {
    setCastlingOverride({ ...castling, [key]: !castling[key] });
  }

  function handleToggleSharing(): void {
    const next = !sharing;
    setShareConsent(next);
    setSharing(next);
  }

  function focusSquare(index: number): void {
    squareButtonRefs.current[index]?.focus({ preventScroll: true });
  }

  function handleSquareKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const square = SQUARES_A8_H1[index];
    const row = Math.floor(index / 8);
    const col = index % 8;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const nr = Math.min(7, Math.max(0, row + move[0]));
      const nc = Math.min(7, Math.max(0, col + move[1]));
      focusSquare(nr * 8 + nc);
      return;
    }
    const key = event.key.toLowerCase();
    if (event.key === "Escape") {
      setPendingColour(null);
      return;
    }
    if (pendingColour && PIECE_KEYS[key]) {
      event.preventDefault();
      chooseValue(square, `${pendingColour}${PIECE_KEYS[key]}` as SquareValue);
      return;
    }
    if (key === "w" || key === "b") {
      event.preventDefault();
      setPendingColour(key);
    } else if (key === "e") {
      event.preventDefault();
      chooseValue(square, "empty");
    }
  }

  function handleSquareFocus(square: string): void {
    if (square !== selectedSquare) setPendingColour(null);
    setSelectedSquare(square);
  }

  function loadImageElement(
    img: HTMLImageElement,
    blob: Blob,
    ext: string,
  ): void {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    if (w < MIN_IMAGE_DIMENSION || h < MIN_IMAGE_DIMENSION) {
      setErrorMessage(
        `Image is too small (${w}x${h}px). Minimum size is ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px.`,
      );
      return;
    }

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = w;
    srcCanvas.height = h;
    const srcCtx = srcCanvas.getContext("2d");
    if (!srcCtx) {
      setErrorMessage("Could not initialize image canvas.");
      return;
    }
    srcCtx.drawImage(img, 0, 0, w, h);
    sourceCanvasRef.current = srcCanvas;

    setPhotoBlob(blob);
    setPhotoExt(ext);
    setImageDimensions({ width: w, height: h });
    setCorners([]);
    setDraggingIndex(null);
    setDragPointerCss(null);
    setStep("corners");
    setRotationSteps90(0);
    setShowSquares(false);
    setCrops([]);
    setClassification(null);
    setErrorMessage(null);
    setSavedNotice(null);
    boardSessionRef.current = null;
    resetLabelling();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Selected file is not an image.");
      return;
    }

    const extFromName = file.name.split(".").pop()?.toLowerCase();
    const ext =
      extFromName && ["jpg", "jpeg", "png", "webp"].includes(extFromName)
        ? extFromName
        : "png";

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      loadImageElement(img, file, ext);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setErrorMessage("Could not decode image file.");
    };
    img.src = url;
  }

  // Draw the source image and the 4-corner polygon onto the display canvas
  useEffect(() => {
    if (step !== "corners" || !imageDimensions || !sourceCanvasRef.current) {
      return;
    }
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceCanvasRef.current, 0, 0);

    if (corners.length >= 2) {
      const scaleFactor = Math.max(
        1,
        Math.round(Math.max(canvas.width, canvas.height) / 600),
      );
      ctx.save();
      ctx.strokeStyle = "#B3261E";
      ctx.lineWidth = 2 * scaleFactor;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i += 1) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      if (corners.length === 4) {
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [step, imageDimensions, corners]);

  // Draw the magnified view into the square-cornered magnifier canvas while dragging
  useEffect(() => {
    if (
      draggingIndex === null ||
      !corners[draggingIndex] ||
      !sourceCanvasRef.current ||
      !magnifierCanvasRef.current
    ) {
      return;
    }
    const magCanvas = magnifierCanvasRef.current;
    magCanvas.width = MAGNIFIER_SIZE;
    magCanvas.height = MAGNIFIER_SIZE;
    const ctx = magCanvas.getContext("2d");
    if (!ctx) return;

    const pt = corners[draggingIndex];
    const sampleRadius = MAGNIFIER_SIZE / (2 * MAGNIFIER_ZOOM);

    ctx.fillStyle = "#F2EEE3";
    ctx.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);

    ctx.drawImage(
      sourceCanvasRef.current,
      pt.x - sampleRadius,
      pt.y - sampleRadius,
      sampleRadius * 2,
      sampleRadius * 2,
      0,
      0,
      MAGNIFIER_SIZE,
      MAGNIFIER_SIZE,
    );

    // Draw crisp crosshair in accent color at the center of the magnifier
    const mid = MAGNIFIER_SIZE / 2;
    ctx.strokeStyle = "#B3261E";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid, MAGNIFIER_SIZE);
    ctx.moveTo(0, mid);
    ctx.lineTo(MAGNIFIER_SIZE, mid);
    ctx.stroke();
  }, [draggingIndex, corners]);

  function clientToImageCoords(clientX: number, clientY: number): {
    imagePoint: Point2D;
    cssPoint: Point2D;
  } | null {
    const canvas = displayCanvasRef.current;
    if (!canvas || !imageDimensions) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const cssX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const cssY = Math.max(0, Math.min(rect.height, clientY - rect.top));

    const imgX = (cssX / rect.width) * imageDimensions.width;
    const imgY = (cssY / rect.height) * imageDimensions.height;

    return {
      imagePoint: { x: imgX, y: imgY },
      cssPoint: { x: cssX, y: cssY },
    };
  }

  function handleCanvasPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (step !== "corners" || !imageDimensions) return;

    const mapped = clientToImageCoords(event.clientX, event.clientY);
    if (!mapped) return;

    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Check if pointer is within 24px (48px touch target) of an existing corner
    let hitIndex: number | null = null;
    let bestDist = Infinity;

    corners.forEach((pt, idx) => {
      const ptCssX = (pt.x / imageDimensions.width) * rect.width;
      const ptCssY = (pt.y / imageDimensions.height) * rect.height;
      const dist = Math.hypot(
        mapped.cssPoint.x - ptCssX,
        mapped.cssPoint.y - ptCssY,
      );
      if (dist <= 26 && dist < bestDist) {
        bestDist = dist;
        hitIndex = idx;
      }
    });

    if (hitIndex !== null) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingIndex(hitIndex);
      setDragPointerCss(mapped.cssPoint);
      return;
    }

    if (corners.length < 4) {
      const nextIndex = corners.length;
      setCorners((prev) => [...prev, mapped.imagePoint]);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingIndex(nextIndex);
      setDragPointerCss(mapped.cssPoint);
    }
  }

  function handleCanvasPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (draggingIndex === null || !imageDimensions) return;
    const mapped = clientToImageCoords(event.clientX, event.clientY);
    if (!mapped) return;

    setCorners((prev) =>
      prev.map((pt, idx) => (idx === draggingIndex ? mapped.imagePoint : pt)),
    );
    setDragPointerCss(mapped.cssPoint);
  }

  function handleCanvasPointerUp(): void {
    if (draggingIndex !== null) {
      setDraggingIndex(null);
      setDragPointerCss(null);
    }
  }

  function drawGridOverlay(
    rawCanvas: HTMLCanvasElement,
    outCanvas: HTMLCanvasElement,
  ): void {
    outCanvas.width = FLATTENED_SIZE;
    outCanvas.height = FLATTENED_SIZE;
    const ctx = outCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, FLATTENED_SIZE, FLATTENED_SIZE);
    ctx.drawImage(rawCanvas, 0, 0);

    ctx.save();
    ctx.strokeStyle = "#B3261E";
    ctx.lineWidth = 1;

    const start = BOARD_MARGIN;
    const end = FLATTENED_SIZE - BOARD_MARGIN;

    for (let i = 0; i <= 8; i += 1) {
      const pos = start + i * SQUARE_SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(pos, start);
      ctx.lineTo(pos, end);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(start, pos);
      ctx.lineTo(end, pos);
      ctx.stroke();
    }

    const session = boardSessionRef.current;
    if (DEBUG_VIEW && session) {
      const side = session.cameraSide;
      const ext = session.cropExtension;
      ctx.lineWidth = 1;
      for (const { tall, base } of tallCropFlatRects(side, ext)) {
        ctx.strokeStyle = "#6B665A";
        ctx.strokeRect(tall.x + 0.5, tall.y + 0.5, tall.w - 1, tall.h - 1);
        ctx.strokeStyle = "#151515";
        ctx.strokeRect(base.x + 3.5, base.y + 3.5, base.w - 7, base.h - 7);
      }
    }

    ctx.restore();
  }

  async function runClassification(
    extracted: SquareCrop[],
    boardId: string,
    cameraSide: CameraSide,
  ): Promise<void> {
    setIsClassifying(true);
    setClassifyProgress(0);
    try {
      const result = await classifySquares(
        extracted,
        (done) => {
          setClassifyProgress(done);
        },
        { cameraSide },
      );
      if (boardSessionRef.current?.boardId !== boardId) return;
      setClassification(result);
      const check = new Set([
        ...result.uncertainSquares,
        ...result.tallCheckSquares,
      ]);
      setLabels((prev) => {
        const next = { ...prev };
        for (const p of result.squares) {
          if (next[p.square]?.state !== "unset") continue;
          next[p.square] = {
            value: symbolToValue(p.symbol),
            state: check.has(p.square) ? "check" : "guessed",
          };
        }
        return next;
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not classify board squares.";
      setErrorMessage(msg);
    } finally {
      setIsClassifying(false);
    }
  }

  async function runFlatten(nextRotationSteps: number): Promise<void> {
    if (!sourceCanvasRef.current || corners.length !== 4) return;
    setIsFlattening(true);
    setErrorMessage(null);
    setClassification(null);

    try {
      const fourCorners: [Point2D, Point2D, Point2D, Point2D] = [
        corners[0],
        corners[1],
        corners[2],
        corners[3],
      ];

      const rawCanvas =
        rawFlattenedCanvasRef.current ?? document.createElement("canvas");
      rawFlattenedCanvasRef.current = rawCanvas;

      await flattenBoardToCanvas(
        sourceCanvasRef.current,
        fourCorners,
        nextRotationSteps,
        rawCanvas,
      );

      const cameraSide = cameraSideFromRotation(nextRotationSteps);
      const info = await getModelInfo();
      const extension =
        info.cropMode === "tall" ? info.cropExtension : TALL_CROP_EXTENSION;
      const legacy = cropSquares(rawCanvas);
      const tall = tallCrops(rawCanvas, cameraSide, extension);
      const extracted = info.cropMode === "tall" ? tall.tall : legacy;
      const boardCanvas = document.createElement("canvas");
      boardCanvas.width = rawCanvas.width;
      boardCanvas.height = rawCanvas.height;
      boardCanvas.getContext("2d")?.drawImage(rawCanvas, 0, 0);
      const boardId = crypto.randomUUID();
      boardSessionRef.current = {
        boardId,
        boardCanvas,
        tallCrops: new Map(tall.tall.map((c) => [c.square, c.image])),
        tightCrops: new Map(tall.tight.map((c) => [c.square, c.image])),
        // Describes the uploaded crop_image_path files, which are always tall.
        cropGeometry: cropGeometryTag(extension),
        cropExtension: extension,
        cameraSide,
        cornerPoints: {
          corners: corners.map((pt) => ({ x: pt.x, y: pt.y })),
          rotationSteps90: nextRotationSteps,
          imageWidth: imageDimensions?.width ?? 0,
          imageHeight: imageDimensions?.height ?? 0,
        },
        uploaded: new Set(),
      };
      resetLabelling();
      setCrops(extracted);
      setStep("flattened");
      setRotationSteps90(nextRotationSteps);

      window.requestAnimationFrame(() => {
        if (flattenedCanvasRef.current && rawFlattenedCanvasRef.current) {
          drawGridOverlay(
            rawFlattenedCanvasRef.current,
            flattenedCanvasRef.current,
          );
        }
      });

      void runClassification(extracted, boardId, cameraSide);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not flatten board image.";
      setErrorMessage(msg);
    } finally {
      setIsFlattening(false);
    }
  }

  useEffect(() => {
    if (
      step === "flattened" &&
      flattenedCanvasRef.current &&
      rawFlattenedCanvasRef.current
    ) {
      drawGridOverlay(
        rawFlattenedCanvasRef.current,
        flattenedCanvasRef.current,
      );
    }
  }, [step, rotationSteps90, classification]);

  function handleRotate90(): void {
    const nextSteps = (rotationSteps90 + 1) % 4;
    void runFlatten(nextSteps);
  }

  function handleSaveForTraining(): void {
    if (!photoBlob || !imageDimensions || corners.length !== 4) return;
    const { baseName } = saveForTraining({
      photoBlob,
      photoExtension: photoExt,
      imageWidth: imageDimensions.width,
      imageHeight: imageDimensions.height,
      corners: [corners[0], corners[1], corners[2], corners[3]],
      rotationSteps90,
      fen: liveFen,
    });
    setSavedNotice(`Saved ${baseName}.${photoExt} and ${baseName}.json`);
  }

  return (
    <div className="stage">
      <section className="board-column" aria-label="Board scanner">
        <input
          ref={takePhotoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="visually-hidden-file"
          onChange={handleFileChange}
        />
        <input
          ref={uploadPhotoInputRef}
          type="file"
          accept="image/*"
          className="visually-hidden-file"
          onChange={handleFileChange}
        />

        {!imageDimensions ? (
          <div className="scan-empty">
            <p>
              Take or upload a photo of a chessboard, then tap its four outer
              corners clockwise starting from top-left.
            </p>
          </div>
        ) : step === "corners" ? (
          <div
            ref={stageWrapRef}
            className="scan-canvas-stage"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
          >
            <canvas
              ref={displayCanvasRef}
              className="scan-display-canvas"
              data-testid="scan-display-canvas"
            />
            {corners.map((pt, idx) => {
              const leftPct = (pt.x / imageDimensions.width) * 100;
              const topPct = (pt.y / imageDimensions.height) * 100;
              return (
                <div
                  key={idx}
                  className="corner-handle"
                  data-testid={`corner-handle-${idx + 1}`}
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                  }}
                >
                  <span className="corner-dot" />
                  <span className="corner-number">{idx + 1}</span>
                </div>
              );
            })}
            {draggingIndex !== null && dragPointerCss ? (
              <div
                className="magnifier-box"
                data-testid="magnifier-box"
                style={{
                  left: `${Math.max(8, dragPointerCss.x - MAGNIFIER_SIZE / 2)}px`,
                  top: `${
                    dragPointerCss.y > MAGNIFIER_SIZE + 24
                      ? dragPointerCss.y - MAGNIFIER_SIZE - 24
                      : dragPointerCss.y + 24
                  }px`,
                }}
              >
                <canvas
                  ref={magnifierCanvasRef}
                  className="magnifier-canvas"
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flattened-container">
            <div className="label-board">
              <canvas
                ref={flattenedCanvasRef}
                className="flattened-canvas"
                data-testid="flattened-canvas"
              />
              <div
                className="label-grid"
                aria-label="Squares, a8 to h1"
                data-testid="label-grid"
              >
                {SQUARES_A8_H1.map((square, index) => {
                  const label = labels[square];
                  const text =
                    label.value && label.value !== "empty" ? label.value : "";
                  const valueWords =
                    label.value === null
                      ? ""
                      : label.value === "empty"
                        ? " empty,"
                        : ` ${label.value},`;
                  return (
                    <button
                      key={square}
                      type="button"
                      ref={(el) => {
                        squareButtonRefs.current[index] = el;
                      }}
                      className="label-square"
                      data-state={label.state}
                      data-selected={selectedSquare === square ? "true" : undefined}
                      aria-label={`${square}${valueWords} ${STATE_WORDS[label.state]}`}
                      onPointerEnter={(e) => {
                        e.currentTarget.focus({ preventScroll: true });
                        handleSquareFocus(square);
                      }}
                      onFocus={() => handleSquareFocus(square)}
                      onClick={() => handleSquareFocus(square)}
                      onKeyDown={(e) => handleSquareKeyDown(e, index)}
                    >
                      {text ? <span className="label-piece">{text}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            {showSquares && crops.length === 64 ? (
              <div
                className="crops-debug-section"
                aria-label="Extracted squares"
              >
                <span className="field-label">
                  Extracted 64 squares ({crops[0].image.width}x
                  {crops[0].image.height}px each, as sent to the model)
                </span>
                <div className="crops-grid" data-testid="crops-grid">
                  {crops.map((crop, idx) => (
                    <SquareThumb
                      key={crop.square}
                      crop={crop}
                      prediction={classification?.squares[idx]}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <aside className="side">
        <div className="setup" aria-label="Photo input">
          <span className="field-label">Photo</span>
          <div className="choice-row">
            <button
              type="button"
              onClick={() => takePhotoInputRef.current?.click()}
            >
              Take photo
            </button>
            <button
              type="button"
              onClick={() => uploadPhotoInputRef.current?.click()}
            >
              Upload photo
            </button>
          </div>
        </div>

        {imageDimensions && step === "corners" ? (
          <div className="editor-section" aria-label="Corner selection">
            <span className="field-label">
              Corners ({corners.length} of 4): 1 top-left, 2 top-right, 3
              bottom-right, 4 bottom-left
            </span>
            <span className="field-label">Camera on</span>
            <div className="choice-row">
              {CAMERA_SIDES.map(({ side, steps, label }) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={rotationSteps90 === steps}
                  onClick={() => setRotationSteps90(steps)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="controls-stack">
              <button
                type="button"
                disabled={corners.length === 0}
                onClick={() => setCorners([])}
              >
                Reset corners
              </button>
              {corners.length === 4 ? (
                <button
                  type="button"
                  disabled={isFlattening}
                  onClick={() => void runFlatten(rotationSteps90)}
                >
                  {isFlattening ? "Flattening" : "Flatten"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "flattened" ? (
          <>
            <div className="editor-section" aria-label="Detected position">
              <span className="field-label">
                {isClassifying
                  ? `Recognizing pieces (${classifyProgress}/64)...`
                  : classification
                    ? `Detected position (${Math.round(classification.meanConfidence * 100)}% avg confidence${classification.adjustedSquares > 0 ? `, ${classification.adjustedSquares} squares corrected by piece counts${classification.usedPositionPrior ? " and game statistics" : ""}` : ""})`
                    : "Piece recognition"}
              </span>
              {classification?.unfamiliarBoard ? (
                <p className="status-line">
                  This board looks unfamiliar to the model:{" "}
                  {classification.uncertainSquares.length} squares are
                  uncertain and marked for checking. Labelling this board
                  teaches the next model.
                </p>
              ) : null}
            </div>

            <div className="editor-section" aria-label="Label squares">
              <span className="field-label">
                {selectedSquare
                  ? `Square ${selectedSquare}: ${labels[selectedSquare].value ?? "not set"}, ${STATE_WORDS[labels[selectedSquare].state]}`
                  : "Select a square on the board"}
              </span>
              <div className="choice-row">
                <button
                  type="button"
                  disabled={!selectedSquare}
                  aria-pressed={
                    selectedSquare !== null &&
                    labels[selectedSquare].value === "empty"
                  }
                  onClick={() =>
                    selectedSquare && chooseValue(selectedSquare, "empty")
                  }
                >
                  Empty
                </button>
                <button
                  type="button"
                  disabled={!selectedSquare}
                  aria-pressed={pickerColour === "w"}
                  onClick={() => setPendingColour("w")}
                >
                  White
                </button>
                <button
                  type="button"
                  disabled={!selectedSquare}
                  aria-pressed={pickerColour === "b"}
                  onClick={() => setPendingColour("b")}
                >
                  Black
                </button>
              </div>
              <div className="choice-row">
                {PICKER_PIECES.map(([letter, name]) => (
                  <button
                    key={letter}
                    type="button"
                    disabled={!selectedSquare || !pickerColour}
                    aria-pressed={
                      selectedSquare !== null &&
                      pickerColour !== null &&
                      labels[selectedSquare].value === `${pickerColour}${letter}`
                    }
                    onClick={() =>
                      selectedSquare &&
                      pickerColour &&
                      chooseValue(
                        selectedSquare,
                        `${pickerColour}${letter}` as SquareValue,
                      )
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
              <p className="label-help">
                Point at a square, then press w or b followed by k q r b n p, or
                e for empty. Arrow keys move between squares. Dashed squares
                need a check.
              </p>
              <p className="label-counter" data-testid="label-counter">
                {confirmedCount} / 64 confirmed
                {syncStatus ? (
                  <span className="label-sync"> {syncStatus}</span>
                ) : null}
              </p>
              <div className="controls-stack">
                <button
                  type="button"
                  disabled={confirmedCount === 64}
                  onClick={handleConfirmAll}
                >
                  Confirm all
                </button>
                <button type="button" onClick={handleFillStart}>
                  Fill starting position
                </button>
              </div>
            </div>

            <div className="editor-section" aria-label="Start the game">
              <span className="field-label">Position</span>
              <code className="fen-output" data-testid="scanned-fen-output">
                {liveFen}
              </code>
              <span className="field-label">Side to move</span>
              <div className="choice-row">
                <button
                  type="button"
                  aria-pressed={turn === "w"}
                  onClick={() => setTurn("w")}
                >
                  White
                </button>
                <button
                  type="button"
                  aria-pressed={turn === "b"}
                  onClick={() => setTurn("b")}
                >
                  Black
                </button>
              </div>
              <span className="field-label">Castling</span>
              <div className="controls-stack">
                {(
                  [
                    ["wK", "White kingside"],
                    ["wQ", "White queenside"],
                    ["bK", "Black kingside"],
                    ["bQ", "Black queenside"],
                  ] as const
                ).map(([key, text]) => (
                  <label key={key} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={castling[key]}
                      onChange={() => handleToggleCastling(key)}
                    />
                    <span>{text}</span>
                  </label>
                ))}
              </div>
              {positionWarning && !loadError ? (
                <p className="status-line">{positionWarning}</p>
              ) : null}
              {loadError ? (
                <p className="status-line">Cannot start yet: {loadError}</p>
              ) : null}
              <div className="controls-stack">
                {onPlayFromHere ? (
                  <button
                    type="button"
                    disabled={loadError !== null}
                    onClick={() => onPlayFromHere(liveFen)}
                  >
                    Start the game
                  </button>
                ) : null}
                {onOpenInEditor ? (
                  <button type="button" onClick={() => onOpenInEditor(liveFen)}>
                    Review & edit position
                  </button>
                ) : null}
              </div>
            </div>

            <div className="editor-section" aria-label="Flattened board actions">
              <span className="field-label">
                Verify grid alignment and orient so a1 is bottom-left
              </span>
              <span className="field-label" data-testid="camera-side">
                Camera: {cameraSideLabel(cameraSideFromRotation(rotationSteps90))}
              </span>
              <div className="controls-stack">
                <button
                  type="button"
                  disabled={isFlattening || isClassifying}
                  onClick={handleRotate90}
                >
                  Rotate 90 degrees
                </button>
                <button
                  type="button"
                  aria-pressed={showSquares}
                  onClick={() => setShowSquares((curr) => !curr)}
                >
                  Show squares
                </button>
                <button type="button" onClick={() => setStep("corners")}>
                  Back
                </button>
              </div>
            </div>

            <div className="editor-section" aria-label="Training data">
              <p className="label-help">
                Your corrections help train the scanner. Each confirmed square is
                saved with its photo crop.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={sharing}
                  onChange={handleToggleSharing}
                />
                <span>Share corrections</span>
              </label>
              <button type="button" onClick={handleSaveForTraining}>
                Save for training
              </button>
              {savedNotice ? (
                <p className="status-line">{savedNotice}</p>
              ) : null}
            </div>
          </>
        ) : null}

        {errorMessage ? <p className="error-line">{errorMessage}</p> : null}

        <div className="controls">
          <button type="button" onClick={onBackHome}>
            Back to game
          </button>
        </div>
      </aside>
    </div>
  );
}
