export function isTransientRequestFailure(error: unknown, httpStatus?: number): boolean {
  if (typeof httpStatus === "number") return httpStatus >= 500;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    return /failed to fetch|networkerror|network error|load failed|offline|econnreset/i.test(
      error.message,
    );
  }
  return false;
}

export function reconnectDelayMs(attempt: number): number {
  const step = Math.min(Math.max(attempt, 1), 5);
  return Math.min(30_000, 2_000 * 2 ** (step - 1));
}

export function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The request was aborted.", "AbortError"));
      return;
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("The request was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
