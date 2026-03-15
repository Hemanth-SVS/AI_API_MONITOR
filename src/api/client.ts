const DEFAULT_BASE_URL = "/api";
const DEFAULT_BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT ?? import.meta.env.SENTINEL_PORT ?? "8787";

export const getApiBaseUrl = () => {
  return import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL;
};

const buildCandidateUrls = (path: string) => {
  const baseUrl = getApiBaseUrl();
  const candidates = [`${baseUrl}${path}`];

  if (
    typeof window !== "undefined" &&
    baseUrl.startsWith("/") &&
    window.location.port &&
    window.location.port !== String(DEFAULT_BACKEND_PORT)
  ) {
    candidates.push(`${window.location.protocol}//${window.location.hostname}:${DEFAULT_BACKEND_PORT}${baseUrl}${path}`);
  }

  return [...new Set(candidates)];
};

const shouldRetryWithFallback = (response: Response) => {
  if ([404, 502, 503, 504].includes(response.status)) {
    return true;
  }

  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/html");
};

const parseErrorMessage = async (response: Response) => {
  let message = `Request failed with status ${response.status}`;

  try {
    const body = await response.json();
    if (body?.error) {
      message = body.error;
    }
  } catch {
    // ignore JSON parse errors
  }

  return message;
};

async function requestWithFallback(
  path: string,
  options: RequestInit,
  responseType: "json" | "text",
) {
  const candidates = buildCandidateUrls(path);
  let lastError: Error | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];

    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: responseType === "json" ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
        ...options,
      });

      if (!response.ok) {
        if (index < candidates.length - 1 && shouldRetryWithFallback(response)) {
          continue;
        }

        throw new Error(await parseErrorMessage(response));
      }

      return responseType === "json" ? response.json() : response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unexpected request failure.");

      if (index === candidates.length - 1) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Unable to reach the API.");
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestWithFallback(path, options, "json") as Promise<T>;
}

export async function apiTextRequest(path: string, options: RequestInit = {}): Promise<string> {
  return requestWithFallback(path, options, "text") as Promise<string>;
}
