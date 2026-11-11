# SnapChess

Coming Soon!

## Retraining from scan labels

After a board is flattened, every square can be confirmed or corrected on the
grid. While "Share corrections" is on (scan side panel, on by default), each
confirmed square is queued in the browser and uploaded to Supabase: one row in
`scan_labels` plus the square's crops in the private `scan-crops` bucket under
`<session_id>/<board_id>/`. Rows are append-only; the latest row per
`(board_id, square)` is the label. Apply
`supabase/migrations/20261111190000_scan_labels_per_square.sql` first.

1. Export the dataset. The service role key reads every user's labels, so it
   belongs in your local shell only, never in `.env` or a `VITE_` variable:

   ```powershell
   $env:SUPABASE_URL = "https://<project>.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
   npm run export:training -- --out dataset --since 2026-11-01
   ```

   This writes `dataset/tall/<label>/<id>.png`, `dataset/tight/<label>/<id>.png`
   (labels `white_king` .. `black_pawn`, `empty`) and `dataset/manifest.csv`.
   `dataset/` is git-ignored.
2. Oversample the rows with `is_correction = true` (for example 3x): those are
   the squares the current model got wrong.
3. Train with exactly the crop geometry the app will use at inference
   (`crop_geometry` in the manifest says what each crop is).
4. Export ONNX to `public/models/snapchess_pieces.onnx`.
5. Bump `model_version` in `public/models/model_info.json` so new labels record
   which model produced the guess.
6. Set the crop mode in `model_info.json` (see below).

## Tall pieces and crop modes

From a low camera, kings, queens and bishops lean into the square behind them.
The corner step asks where the camera stood (White's side, Black's side, the
a-file or the h-file); that sets the flatten rotation so White ends up at the
bottom, and tells the scanner which way pieces lean.

`src/scanner/tallCrops.ts` cuts a tall crop per square from a camera frame (the
flattened board rotated so the camera edge is at the bottom): the base square
plus `TALL_CROP_EXTENSION` squares above it (default 1.2, sensible range 1.0 to
1.6), 0.15 squares on each side and 0.1 below. The base square is always at the
same place at the bottom of the crop; nothing is drawn on it. A tight 100x100
crop of the square is cut from the same frame. Open the scanner with `?debug=1`
to see the tall crop rectangles and base squares drawn over the flattened board.

The crop mode is versioned with the model in `public/models/model_info.json`:

```json
"crop": { "mode": "tall", "extension": 1.2 }
```

No `mode` means `legacy`, which is what the current model was trained on:
100x150 crops in the flattened frame stretched to 96x144. In `tall` mode crops
are letterboxed (aspect kept, centred, padded with black) to 96x144.

- Training and inference must use the identical crop: same mode, same
  extension, same camera frame and the same letterbox. A mismatch silently
  ruins accuracy.
- The training pipeline (the separate `snapchess-model` repo) needs a matching
  tall crop before `mode` is set to `tall` here. Until then keep `legacy`.
- The export saves both tall and tight crops of every label, so the two can be
  compared when training. `crop_geometry` (for example `tall-1.2`) describes the
  uploaded tall crop and `camera_side` the camera edge.
