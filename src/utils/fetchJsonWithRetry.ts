type FetchJsonWithRetryOptions<T> = {
  fallback: T;
  init?: RequestInit;
  retries?: number;
  retryDelayMs?: number;
  label?: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJsonWithRetry<T>(
  url: string,
  options: FetchJsonWithRetryOptions<T>
): Promise<T> {
  const {
    fallback,
    init,
    retries = 1,
    retryDelayMs = 300,
    label,
  } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...init,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      const name = label || url;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[fetchJsonWithRetry] ${name} failed on attempt ${attempt + 1}: ${message}`);

      if (attempt < retries) {
        await delay(retryDelayMs);
        continue;
      }
    }
  }

  return fallback;
}