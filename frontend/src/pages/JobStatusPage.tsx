import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatJobStatus, getJob, pollJobUntilTerminal } from "../api/jobs";
import type { GetJobResponse, JobStatus } from "../types";
import { isTerminalJobStatus } from "../types";
import "../App.css";
import "./JobStatusPage.css";

function statusClass(status: JobStatus): string {
  if (status === "completed") return "status-badge status-badge--success";
  if (status === "failed") return "status-badge status-badge--error";
  if (status === "completed_with_errors") {
    return "status-badge status-badge--warning";
  }
  return "status-badge status-badge--pending";
}

function progressPercent(job: GetJobResponse): number {
  if (!job.totalImages) return 0;
  return Math.round(
    ((job.completedCount + job.failedCount) / job.totalImages) * 100,
  );
}

export default function JobStatusPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<GetJobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;

    cancelledRef.current = false;

    async function load() {
      try {
        const initial = await getJob(jobId!, { includeImages: true });
        if (cancelledRef.current) return;
        setJob(initial);

        if (isTerminalJobStatus(initial.status)) {
          setPolling(false);
          return;
        }

        await pollJobUntilTerminal(jobId!, (updated) => {
          if (!cancelledRef.current) setJob(updated);
        });

        if (!cancelledRef.current) setPolling(false);
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load job");
          setPolling(false);
        }
      }
    }

    load();

    return () => {
      cancelledRef.current = true;
    };
  }, [jobId]);

  if (!jobId) {
    return (
      <main className="card">
        <p className="message message--error">Missing job ID.</p>
      </main>
    );
  }

  return (
    <main className="card job-status">
      <div className="job-status__header">
        <div>
          <h2 className="card__title">Job status</h2>
          <p className="job-id">
            Job ID: <code>{jobId}</code>
          </p>
        </div>
        <Link to="/bulk" className="link-back">
          New bulk job
        </Link>
      </div>

      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}

      {!job && !error && (
        <p className="message message--info">Loading job status…</p>
      )}

      {job && (
        <>
          <div className="job-summary">
            <span className={statusClass(job.status)}>
              {formatJobStatus(job.status)}
            </span>
            {polling && (
              <span className="polling-indicator">Long polling…</span>
            )}
          </div>

          <div className="progress-block">
            <div className="progress-bar" aria-hidden="true">
              <div
                className="progress-bar__fill"
                style={{ width: `${progressPercent(job)}%` }}
              />
            </div>
            <p className="progress-text">
              {job.completedCount + job.failedCount} / {job.totalImages} images
              finished ({progressPercent(job)}%)
            </p>
          </div>

          <dl className="stats">
            <div>
              <dt>Completed</dt>
              <dd>{job.completedCount}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{job.failedCount}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd>{job.processingCount}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{job.pendingCount}</dd>
            </div>
          </dl>

          <section className="pipeline-summary">
            <h3>Pipeline</h3>
            <ol>
              {job.pipeline.steps.map((step, index) => (
                <li key={index}>{step.filter}</li>
              ))}
            </ol>
          </section>

          {job.images && job.images.length > 0 && (
            <section className="image-list">
              <h3>Images</h3>
              <ul>
                {job.images.map((image) => (
                  <li key={image.imageId} className="image-row">
                    <div className="image-row__meta">
                      <span
                        className={`image-status image-status--${image.status}`}
                      >
                        {image.status}
                      </span>
                      <span className="image-id">#{image.imageId}</span>
                      {image.failedReason && (
                        <span className="image-error">{image.failedReason}</span>
                      )}
                    </div>
                    {image.processedUrl && (
                      <img
                        src={image.processedUrl}
                        alt={`Processed ${image.imageId}`}
                        className="image-thumb"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
