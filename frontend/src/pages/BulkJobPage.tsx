import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createBulkJob,
  FILTER_OPTIONS,
  MAX_IMAGES_PER_JOB,
} from "../api/jobs";
import { MAX_FILE_BYTES } from "../api/images";
import type { FilterType, PipelineStep } from "../types";
import "../App.css";
import "./BulkJobPage.css";

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BulkJobPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [steps, setSteps] = useState<PipelineStep[]>([
    { filter: "grayscale" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFilesChange(selected: FileList | null) {
    setError(null);
    if (!selected?.length) {
      setFiles([]);
      return;
    }

    const next = Array.from(selected);
    const invalid = next.find(
      (file) => !file.type.startsWith("image/") || file.size > MAX_FILE_BYTES,
    );

    if (invalid) {
      if (!invalid.type.startsWith("image/")) {
        setError("All files must be images.");
      } else {
        setError(
          `${invalid.name} exceeds ${formatBytes(MAX_FILE_BYTES)} limit.`,
        );
      }
      setFiles([]);
      return;
    }

    if (next.length > MAX_IMAGES_PER_JOB) {
      setError(`Maximum ${MAX_IMAGES_PER_JOB} images per job.`);
      setFiles([]);
      return;
    }

    setFiles(next);
  }

  function updateStep(index: number, filter: FilterType) {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { filter } : step)),
    );
  }

  function addStep() {
    setSteps((current) => [...current, { filter: "sharpen" }]);
  }

  function removeStep(index: number) {
    setSteps((current) =>
      current.length === 1 ? current : current.filter((_, i) => i !== index),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!files.length || loading) return;

    setLoading(true);
    setError(null);

    try {
      const result = await createBulkJob(files, {
        pipelineVersion: 1,
        steps,
      });
      navigate(`/jobs/${result.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
      setLoading(false);
    }
  }

  return (
    <main className="card">
      <h2 className="card__title">Bulk processing (async)</h2>
      <p className="card__subtitle">
        Upload multiple images, define a multi-step filter pipeline, and track
        progress on the job status page.
      </p>

      <form onSubmit={handleSubmit} className="form">
        <label className="field">
          <span className="label">Images</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFilesChange(e.target.files)}
            disabled={loading}
          />
          <span className="hint">
            Up to {MAX_IMAGES_PER_JOB} images, {formatBytes(MAX_FILE_BYTES)} each
          </span>
        </label>

        {files.length > 0 && (
          <p className="file-count">{files.length} image(s) selected</p>
        )}

        <fieldset className="pipeline">
          <legend className="label">Filter pipeline</legend>
          {steps.map((step, index) => (
            <div key={index} className="pipeline__step">
              <span className="pipeline__index">Step {index + 1}</span>
              <select
                value={step.filter}
                onChange={(e) =>
                  updateStep(index, e.target.value as FilterType)
                }
                disabled={loading}
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pipeline__remove"
                onClick={() => removeStep(index)}
                disabled={loading || steps.length === 1}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="pipeline__add"
            onClick={addStep}
            disabled={loading}
          >
            Add step
          </button>
        </fieldset>

        <button
          type="submit"
          className="submit"
          disabled={!files.length || loading}
        >
          {loading ? "Creating job…" : "Start bulk job"}
        </button>
      </form>

      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
