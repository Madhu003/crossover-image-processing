import type {
  ApiErrorBody,
  CreateJobResponse,
  FilterType,
  GetJobResponse,
  PipelineDefinition,
} from "../types";
import { fileToBase64 } from "./images";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const MAX_IMAGES_PER_JOB = 50;

async function parseError(response: Response): Promise<string> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.error) message = body.error;
  } catch {
    // ignore parse errors
  }
  return message;
}

export async function createBulkJob(
  files: File[],
  pipeline: PipelineDefinition,
): Promise<CreateJobResponse> {
  const images = await Promise.all(files.map((file) => fileToBase64(file)));

  const response = await fetch(`${API_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, pipeline }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<CreateJobResponse>;
}

export async function getJob(
  jobId: string,
  options?: {
    wait?: boolean;
    timeoutMs?: number;
    includeImages?: boolean;
  },
): Promise<GetJobResponse> {
  const params = new URLSearchParams();
  if (options?.wait) params.set("wait", "true");
  if (options?.timeoutMs) params.set("timeout", String(options.timeoutMs));
  if (options?.includeImages) params.set("includeImages", "true");

  const query = params.toString();
  const url = `${API_URL}/jobs/${encodeURIComponent(jobId)}${query ? `?${query}` : ""}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<GetJobResponse>;
}

export async function pollJobUntilTerminal(
  jobId: string,
  onUpdate: (job: GetJobResponse) => void,
  options?: { longPollTimeoutMs?: number },
): Promise<GetJobResponse> {
  const timeoutMs = options?.longPollTimeoutMs ?? 25_000;

  while (true) {
    const job = await getJob(jobId, {
      wait: true,
      timeoutMs,
      includeImages: true,
    });
    onUpdate(job);

    if (
      job.status === "completed" ||
      job.status === "completed_with_errors" ||
      job.status === "failed"
    ) {
      return job;
    }
  }
}

export const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: "grayscale", label: "Grayscale" },
  { value: "sepia", label: "Sepia" },
  { value: "sharpen", label: "Sharpen" },
];

export function formatJobStatus(status: string): string {
  return status.replace(/_/g, " ");
}
