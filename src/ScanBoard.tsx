import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  type BoardClassification,
  type SquarePrediction,
} from "./scanner/classifyBoard";
import { STARTING_FEN, validateFenString } from "./fenValidator";
import { saveForTraining } from "./scanner/trainingExport";

const MIN_IMAGE_DIMENSION = 200;
const MAGNIFIER_SIZE = 120;
const MAGNIFIER_ZOOM = 2.5;

type ScanStep = "corners" | "flattened";

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
  const [trainingFen, setTrainingFen] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

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
    preds?: SquarePrediction[] | null,
    uncertain?: string[] | null,
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

    if (preds && preds.length === 64) {
      ctx.font = '600 22px "IBM Plex Mono", "Courier New", monospace';
      ctx.textBaseline = "bottom";
      const unsure = new Set(uncertain ?? []);
      for (let i = 0; i < 64; i += 1) {
        const p = preds[i];
        if (!p) continue;
        const row = Math.floor(i / 8);
        const col = i % 8;
        if (unsure.has(p.square)) {
          const qx = start + (col + 1) * SQUARE_SIZE - 25;
          const qy = start + row * SQUARE_SIZE + 28;
          ctx.fillStyle = "#F2EEE3";
          ctx.fillRect(qx - 3, qy - 24, 22, 24);
          ctx.strokeStyle = "#151515";
          ctx.strokeRect(qx - 3, qy - 24, 22, 24);
          ctx.fillStyle = "#151515";
          ctx.fillText("?", qx + 2, qy);
        }
        if (p.symbol === "empty") continue;
        const x = start + col * SQUARE_SIZE + 6;
        const y = start + (row + 1) * SQUARE_SIZE - 4;
        ctx.fillStyle = "rgba(242, 238, 227, 0.88)";
        ctx.fillRect(x - 3, y - 24, 22, 24);
        ctx.strokeStyle = "#151515";
        ctx.strokeRect(x - 3, y - 24, 22, 24);
        ctx.fillStyle = "#B3261E";
        ctx.fillText(p.symbol, x, y);
      }
    }

    ctx.restore();
  }

  async function runClassification(extracted: SquareCrop[]): Promise<void> {
    setIsClassifying(true);
    setClassifyProgress(0);
    try {
      const result = await classifySquares(extracted, (done) => {
        setClassifyProgress(done);
      });
      setClassification(result);
      setTrainingFen(result.fen);
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

      const extracted = cropSquares(rawCanvas);
      setCrops(extracted);
      setStep("flattened");
      setRotationSteps90(nextRotationSteps);

      window.requestAnimationFrame(() => {
        if (flattenedCanvasRef.current && rawFlattenedCanvasRef.current) {
          drawGridOverlay(
            rawFlattenedCanvasRef.current,
            flattenedCanvasRef.current,
            null,
          );
        }
      });

      void runClassification(extracted);
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
        classification?.squares ?? null,
        classification?.uncertainSquares ?? null,
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
      fen: trainingFen,
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
            <canvas
              ref={flattenedCanvasRef}
              className="flattened-canvas"
              data-testid="flattened-canvas"
            />
            {showSquares && crops.length === 64 ? (
              <div
                className="crops-debug-section"
                aria-label="Extracted squares"
              >
                <span className="field-label">
                  Extracted 64 squares (100x150px each)
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
                  onClick={() => void runFlatten(0)}
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
              {classification ? (
                <>
                  <code className="fen-output" data-testid="scanned-fen-output">
                    {classification.fen}
                  </code>
                  {classification.unfamiliarBoard ? (
                    <p className="status-line">
                      This board looks unfamiliar to the model:{" "}
                      {classification.uncertainSquares.length} squares are
                      uncertain (marked ?), so no guesses were filled in. Save a
                      few labelled photos of this set below to teach the next
                      model.
                    </p>
                  ) : null}
                  <div className="controls-stack">
                    {onOpenInEditor ? (
                      <button
                        type="button"
                        onClick={() => onOpenInEditor(classification.fen)}
                      >
                        Review & edit position
                      </button>
                    ) : null}
                    {onPlayFromHere &&
                    validateFenString(classification.fen).valid ? (
                      <button
                        type="button"
                        onClick={() => onPlayFromHere(classification.fen)}
                      >
                        Play from here
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>

            <div className="editor-section" aria-label="Flattened board actions">
              <span className="field-label">
                Verify grid alignment and orient so a1 is bottom-left
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

            <div className="editor-section" aria-label="Training data export">
              <label className="field-label" htmlFor="training-fen-input">
                FEN for training (optional)
              </label>
              <input
                id="training-fen-input"
                type="text"
                value={trainingFen}
                onChange={(e) => setTrainingFen(e.target.value)}
                placeholder="Type FEN for this photo"
              />
              <div className="controls-stack">
                <button
                  type="button"
                  onClick={() => setTrainingFen(STARTING_FEN)}
                >
                  Starting position
                </button>
                {classification ? (
                  <button
                    type="button"
                    onClick={() => setTrainingFen(classification.fen)}
                  >
                    Use detected position
                  </button>
                ) : null}
              </div>
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
