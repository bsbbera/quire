/*
 * One place the shim says what it is doing.
 *
 * Comfy and Affinity are the two things here that take minutes, and both were
 * silent for all of them: a caller posted a job, waited, and got a result or a
 * timeout with nothing in between. The Studio could not show progress because
 * nothing was told any.
 *
 * Deliberately tiny. No history, no replay, no per-topic channels — a
 * subscriber gets what happens after it connects, and anything that must
 * survive a disconnect belongs in a state file, not in a stream. The Studio
 * proxies this into its own event stream so a browser opens one connection
 * rather than two.
 */

const subscribers = new Set();

/** Attach a response as an SSE stream until the client goes away. */
export function subscribe(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  // Without these the first bytes sit in Node's buffer, and a stream whose
  // headers have not been flushed looks dead to the client that just opened it.
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
  res.write(": open\n\n");

  subscribers.add(res);

  /* A proxy between here and the browser will close an idle connection, and
     the reconnect that follows loses whatever was emitted in the gap. A
     comment every twenty seconds is not an event and costs nothing. */
  const beat = setInterval(() => {
    if (res.writableEnded) return;
    res.write(": beat\n\n");
  }, 20000);

  const drop = () => {
    clearInterval(beat);
    subscribers.delete(res);
  };
  req.on("close", drop);
  res.on("close", drop);
  res.on("error", drop);
}

/**
 * Say something happened.
 *
 * Never throws and never awaits: an emit sits inside a render loop and a build
 * script, and a broken subscriber must not be able to fail the work that was
 * only reporting on itself.
 */
export function emit(type, data = {}) {
  if (subscribers.size === 0) return;
  const frame = `data: ${JSON.stringify({ type, ...data, at: Date.now() })}\n\n`;
  for (const res of [...subscribers]) {
    try {
      if (res.writableEnded) subscribers.delete(res);
      else res.write(frame);
    } catch {
      subscribers.delete(res);
    }
  }
}

/** How many listeners there are — the doctor route reports it. */
export function subscriberCount() {
  return subscribers.size;
}
