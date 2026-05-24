import { FormEvent, useState } from "react";
import {
  MAX_FILE_BYTES,
  uploadAndProcessImage,
} from "../api/images";
import type { FilterType, UploadImageResponse } from "../types";
import "../App.css";

const FILTERS: { value: FilterType; label: string }[] = [
  { value: "grayscale", label: "Grayscale" },
  { value: "sepia", label: "Sepia" },
  { value: "sharpen", label: "Sharpen" },
];

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SingleImagePage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("grayscale");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadImageResponse | null>(null);

  function handleFileChange(next: File | null) {
    setError(null);
    setResult(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    if (!next) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    if (!next.type.startsWith("image/")) {
      setError("Please choose an image file.");
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    if (next.size > MAX_FILE_BYTES) {
      setError(
        `File is too large (${formatBytes(next.size)}). Maximum is ${formatBytes(MAX_FILE_BYTES)}.`,
      );
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await uploadAndProcessImage(file, filter);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="card">
      <h2 className="card__title">Single image (sync)</h2>
      <p className="card__subtitle">
        Upload one image and wait for the processed result inline.
      </p>

      <form onSubmit={handleSubmit} className="form">
        <label className="field">
          <span className="label">Image</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            disabled={loading}
          />
          <span className="hint">Max size {formatBytes(MAX_FILE_BYTES)}</span>
        </label>

        <label className="field">
          <span className="label">Filter</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            disabled={loading}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="submit" disabled={!file || loading}>
          {loading ? "Processing…" : "Apply filter"}
        </button>
      </form>

      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}

      {loading && (
        <p className="message message--info">
          Processing your image. This usually finishes in under 30 seconds.
        </p>
      )}

      <div className="previews">
        {previewUrl && (
          <figure className="preview">
            <figcaption>Original</figcaption>
            <img src={previewUrl} alt="Selected upload preview" />
          </figure>
        )}

        {result && (
          <figure className="preview">
            <figcaption>Processed</figcaption>
            <img src={result.processedUrl} alt="Processed result" />
          </figure>
        )}
      </div>
    </main>
  );
}
