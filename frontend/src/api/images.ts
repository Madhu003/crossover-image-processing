import type { ApiErrorBody, FilterType, UploadImageResponse } from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const MAX_FILE_BYTES = 4.5 * 1024 * 1024;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function uploadAndProcessImage(
  file: File,
  filter: FilterType,
): Promise<UploadImageResponse> {
  const image = await fileToBase64(file);

  const response = await fetch(`${API_URL}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, filter }),
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.error) message = body.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  return response.json() as Promise<UploadImageResponse>;
}
