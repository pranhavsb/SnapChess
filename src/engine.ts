let worker: Worker | null = null;
let readyPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<Worker>((resolve, reject) => {
    const instance = new Worker("/stockfish/stockfish-19-lite-single.js");
    worker = instance;

    function handleInit(event: MessageEvent) {
      const line = typeof event.data === "string" ? event.data.trim() : "";
      if (line === "uciok") {
        instance.removeEventListener("message", handleInit);
        resolve(instance);
      }
    }

    instance.addEventListener("message", handleInit);
    instance.addEventListener("error", (err) => {
      readyPromise = null;
      worker = null;
      reject(err);
    });

    instance.postMessage("uci");
  });

  return readyPromise;
}

export function getBestMove(fen: string, skillLevel: number): Promise<string> {
  const clampedSkill = Math.max(0, Math.min(20, Math.round(skillLevel)));

  const run = async (): Promise<string> => {
    const engine = await getWorker();

    return new Promise<string>((resolve) => {
      let waitingForReady = true;

      function onMessage(event: MessageEvent) {
        const line = typeof event.data === "string" ? event.data.trim() : "";
        if (!line) return;

        if (waitingForReady && line === "readyok") {
          waitingForReady = false;
          engine.postMessage(`position fen ${fen}`);
          engine.postMessage("go movetime 600");
          return;
        }

        if (line.startsWith("bestmove ")) {
          engine.removeEventListener("message", onMessage);
          const parts = line.split(/\s+/);
          resolve(parts[1] ?? "");
        }
      }

      engine.addEventListener("message", onMessage);
      engine.postMessage("stop");
      engine.postMessage(`setoption name Skill Level value ${clampedSkill}`);
      engine.postMessage("isready");
    });
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function stopEngine(): void {
  if (worker) {
    worker.postMessage("stop");
  }
}
