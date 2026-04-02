export async function readJsonResponse<T>(
  response: Response,
  options?: {
    label?: string;
    fallback?: T;
  }
): Promise<T> {
  const label = options?.label || "Response";
  const rawText = await response.text();
  const text = rawText.trim();

  if (!text) {
    if (options && "fallback" in options) {
      return options.fallback as T;
    }
    throw new Error(`${label} returned an empty response body`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`${label} returned non-JSON content: ${preview}`);
  }
}
