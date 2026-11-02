import { API_BASE, QUEUE_LIMIT } from "./config.js";
import { getState, setState } from "./state.js";

async function post(installId, summary) {
  const res = await fetch(`${API_BASE}/api/v1/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Install-ID": installId },
    body: JSON.stringify(summary),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const err = new Error(`Backend answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

// A 4xx means the item itself is wrong, so retrying will never help. Drop it.
const isClientError = (e) => typeof e.status === "number" && e.status >= 400 && e.status < 500;

async function flushQueue(installId) {
  const { queue } = await getState();
  if (queue.length === 0) return;

  const remaining = [];
  let offline = false;
  for (const item of queue) {
    if (offline) {
      remaining.push(item);
      continue;
    }
    try {
      await post(installId, item);
    } catch (e) {
      if (isClientError(e)) continue; // drop it
      offline = true;
      remaining.push(item);
    }
  }
  await setState({ queue: remaining });
}

async function enqueue(summary) {
  const { queue } = await getState();
  queue.push(summary);
  await setState({ queue: queue.slice(-QUEUE_LIMIT) }); // keep the newest
}

// Sends are serialised so two quick page loads cannot flush the queue twice.
let chain = Promise.resolve();

export function sendOrQueue(installId, summary) {
  chain = chain.then(async () => {
    try {
      await flushQueue(installId);
      await post(installId, summary);
    } catch (e) {
      if (isClientError(e)) {
        console.warn("The backend rejected a scan summary:", e.message);
        return;
      }
      await enqueue(summary); // backend offline or slow
    }
  });
  return chain;
}
