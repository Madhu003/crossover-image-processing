# Aperture — Architecture Scenarios

Post-MVP evolution for a B2B image-processing SaaS (~1,000 orgs, 20% MoM growth, power users processing thousands of photos). Current baseline: synchronous flow, single Proxy Lambda, API Gateway, S3 + single-table DynamoDB, one filter per request, 4.5 MB upload cap, ~30s completion target.

---

## Scenario A: Bulk Processing Pipeline

Enterprise customer needs a **custom multi-step filter pipeline** on **hundreds of large images**. Today: one image, one filter, synchronous, base64-in-JSON, 4.5 MB limit.

### Important Facts

| Fact | Why it matters |
|------|----------------|
| **API Gateway + Lambda have hard timeouts** (~30s API GW; Lambda max 15 min). | Synchronous `POST /images` cannot stretch to minutes/hours; bulk must become **async jobs**. |
| **Base64 in JSON does not scale** for hundreds of large files (payload size, memory, cost). | Upload path must move to **direct-to-S3** (presigned URLs / multipart). |
| **Power users already stress flat-rate economics.** | Bulk jobs need **metering** (image count, GB, pipeline steps) even if billing is out of scope here. |
| **S3 + DynamoDB single-table design already fits org-scoped access.** | Extend with `JOB#` / `PIPELINE#` entities rather than a new database. |
| **Processing is CPU/memory bound (Sharp today).** | Multi-step pipelines multiply work; workers need **right-sized compute** separate from the thin API Lambda. |
| **Partial failure is expected at scale.** | Must support **per-image status**, retries, and resumability—not all-or-nothing in one Lambda invocation. |

### Important Technical Decisions

#### 1. Async job model instead of extending the sync API

**Problem:** Hundreds of images × multiple filters cannot complete inside one HTTP request or one Proxy Lambda call.

**Alternatives considered:**
- Keep `POST /images` and poll with long timeouts (blocks connections, brittle).
- WebSockets for progress (more moving parts for browsers and ops).
- **Job + queue + workers** with `POST /jobs` returning `jobId` immediately.

**Decision:** Introduce **Bulk Job API** (`POST /jobs`, `GET /jobs/:id`, optional `GET /jobs/:id/images`) while **keeping** `POST /images` for the existing single-image UX.

**Rationale:** Minimal break for current customers; enterprise bulk is a new access pattern. Jobs map cleanly to DynamoDB (`status`, `progress`, `failedCount`) and are easy to debug in CloudWatch by `jobId`.

---

#### 2. Presigned S3 multipart uploads for ingest

**Problem:** How do users upload hundreds of large images?

**Alternatives considered:**
- Continue base64 through API (fails size/gateway limits immediately).
- Upload service that proxies bytes through Lambda (expensive, timeout risk).
- **Client → S3 via presigned POST/multipart**; API only issues URLs and records metadata.

**Decision:** `POST /jobs` creates a job record → API returns **per-file or batch presigned upload URLs** → client uploads directly to S3 under `s3://…/jobs/{jobId}/original/{imageId}` → **S3 event** (or completion callback) enqueues processing.

**Rationale:** Reuses existing S3 storage; API stays small and fast. Multipart handles large files. Same pattern works for desktop agents later.

---

#### 3. Pipeline definition as versioned JSON, executed by a worker chain

**Problem:** How to model “filter A → B → C”?

**Alternatives considered:**
- Hard-code pipelines in application code (unmaintainable per enterprise).
- **Declarative pipeline spec** stored on the job (`steps: [{ filterId, params }]`).
- Step Functions ASL per customer (powerful but heavy ops burden).

**Decision:** Store **`pipelineVersion` + `steps[]`** on the job in DynamoDB. A **Pipeline Executor** (Lambda or container worker) runs steps sequentially per image, writing intermediate artifacts to S3 only when needed (or in-memory for small images).

**Rationale:** JSON spec is easy to validate, audit, and expose in UI. Executor can be tested locally. Step Functions can orchestrate *job-level* fan-out later without encoding every filter in ASL.

---

#### 4. SQS + worker pool for fan-out (not one Lambda per 500 images in series)

**Problem:** Processing takes minutes to hours; how to scale and isolate failures?

**Alternatives considered:**
- Single long-running Lambda looping 500 images (blast radius, no parallelism).
- **SQS queue**: one message per `(jobId, imageId)` processed by N workers.
- Immediate Step Functions Map state (good, but more cost/complexity for v1 bulk).

**Decision:** On upload complete, enqueue **one SQS message per image**. Workers pull messages, run the pipeline, update **per-image row** in DynamoDB (`pending | processing | completed | failed`), increment job counters atomically.

**Rationale:** Simple ops story (DLQ for poison messages, visibility timeout for retries). Scale workers horizontally for power users. Fits incremental rollout: start with Lambda consumers; move heavy pipelines to Fargate if Sharp + multi-step exceeds Lambda memory/time.

---

#### 5. Failure handling: per-image retry + job-level terminal state

**Problem:** What if processing fails partway through?

**Alternatives considered:**
- Fail entire job on first error (bad UX for 499/500 success).
- Retry whole job from scratch (wasteful).
- **Per-image retries** (SQS redrive, max attempts) + job status `completed_with_errors`.

**Decision:**
- Each image: idempotent worker keyed by `(jobId, imageId)`; write outputs to deterministic S3 keys.
- Failed images: `failedReason` on image record; optional `POST /jobs/:id/retry-failed`.
- Job completes when all images terminal; expose counts in `GET /jobs/:id`.

**Rationale:** Matches enterprise expectations (bulk imports always have stragglers). Idempotency prevents duplicate charges and duplicate S3 objects on retry.

---

#### 6. Raise size limits only on the bulk path

**Problem:** 4.5 MB cap exists for sync product limitation.

**Decision:** Keep **4.5 MB for `POST /images`**; allow **higher cap on presigned bulk path** (e.g. 50–100 MB) with org/feature flag.

**Rationale:** Avoids regressing the simple path; enterprise tier explicitly opts into different constraints and infrastructure cost.

---

### Scenario A — End-state sketch

```
Client → POST /jobs → DynamoDB (job + pipeline spec)
       → presigned S3 uploads
S3 event → SQS (per image) → Worker(s) → S3 processed + DynamoDB image status
Client → GET /jobs/:id (poll or webhook later)
```

**Incremental path:** (1) presigned upload + async single-filter job, (2) multi-step pipeline in worker, (3) DLQ + retry UI, (4) webhooks/Slack for job complete.

---

## Scenario B: Third-Party Filter Marketplace

Open platform: developers publish filters; customers purchase and use them on images.

### Important Facts

| Fact | Why it matters |
|------|----------------|
| **Third-party code is untrusted.** | Must **isolate** execution; never run vendor code in the Proxy Lambda process. |
| **Filters are versioned products.** | Breaking API changes hurt paying customers; need **semver + deprecation policy**. |
| **Billing/revenue share implies auditability.** | Every filter invocation needs a **durable usage event** (who, which filter version, org, outcome). |
| **Today’s filter is in-process Sharp.** | Marketplace filters need a **stable host contract** (inputs/outputs on S3), not shared memory. |
| **Sync path may still exist for simple filters.** | Platform filters on hot path may need **timeout budgets** and async fallback for slow vendors. |
| **~1,000 orgs, growing.** | Registry and metering can start simple (DynamoDB + S3 artifacts); avoid Kubernetes-for-day-one. |

### Important Technical Decisions

#### 1. Filter Host contract: S3 in, S3 out, JSON config

**Problem:** What is the API between Aperture and third-party filters?

**Alternatives considered:**
- Pass raw pixels in Lambda event (size limits, coupling).
- gRPC streaming (complex for indie developers).
- **Canonical contract:** `inputS3Uri`, `outputS3Prefix`, `params`, `context` (orgId, imageId) → `status` + `outputS3Uri` + optional metadata.

**Decision:** Publish a **Filter Host Protocol (v1)** document: worker downloads input from S3, invokes filter in sandbox, uploads output, returns structured result. First-party Sharp filters implement the same interface internally.

**Rationale:** Same contract for sync (short jobs) and bulk workers. Vendors test locally with MinIO + a CLI. No dependency on our DynamoDB schema inside their code.

---

#### 2. Sandboxed execution via dedicated “Filter Runner” Lambdas (not the Proxy Lambda)

**Problem:** How to isolate third-party code from core?

**Alternatives considered:**
- `vm2` / `isolated-vm` in Proxy Lambda (insufficient isolation for production).
- **Per-filter Lambda** deployed to our account from CI (strong isolation, ops overhead).
- **Single Filter Runner** with **container images** per filter (Fargate/Lambda container) and IAM-scoped credentials.

**Decision (phased):**
- **Phase 1:** Vendor submits **container image** (or zip for managed runtime) → we deploy to **dedicated Lambda per filter major version** with minimal IAM (read one input prefix, write one output prefix, no VPC DB access).
- **Phase 2:** For untrusted/heavy filters, **Fargate Spot** tasks with same contract.

**Rationale:** Lambda per filter gives blast-radius isolation and independent timeouts/memory. Proxy Lambda only routes and records metadata—never loads vendor code. Operational cost is real but predictable; Step Functions not required for v1.

---

#### 3. Filter registry in DynamoDB + artifacts in S3

**Problem:** How do developers submit and deploy filters?

**Alternatives considered:**
- Git-only deploys (no marketplace UX).
- **Registry table:** `FILTER#<filterId>` / `VERSION#<semver>` with manifest, pricing, approval status; artifact in `s3://filters/{id}/{version}/`.
- Public npm packages (supply-chain risk).

**Decision:** Developer portal → upload artifact + manifest → **automated validation pipeline** (lint contract, scan image, smoke test on sample assets) → manual/auto approval → deploy to Filter Runner.

**Rationale:** Reuses single-table patterns (`ORG#` subscriptions link org to purchased `filterId@version`). S3 stores immutable versions; DynamoDB holds searchable metadata and entitlement.

---

#### 4. Versioning: immutable semver, deprecation window, runtime pinning

**Problem:** Versioning, deprecation, breaking changes?

**Alternatives considered:**
- Floating `latest` only (breaks production pipelines).
- **Immutable versions**; jobs pin `filterId@1.2.0`; marketplace shows deprecation date; new jobs default to latest **approved** minor.

**Decision:**
- Manifest includes `protocolVersion`, `entrypoint`, `memoryMb`, `timeoutSec`.
- **Breaking protocol** → new `protocolVersion` with adapter in Host.
- Orgs can **pin** filter versions in pipeline definitions; bulk jobs snapshot versions at creation time.

**Rationale:** Enterprise pipelines don’t change behavior when a vendor ships v2. Support can reproduce bugs with exact version + S3 inputs.

---

#### 5. Entitlements and usage metering as first-class events

**Problem:** What does billing/revenue share require technically?

**Alternatives considered:**
- Aggregate from CloudWatch logs (fragile).
- **Usage event stream:** each invocation emits `{ orgId, filterId, version, imageId, durationMs, outcome }` to **Kinesis → durable store** (DynamoDB billing table or data warehouse).

**Decision:** Filter Runner emits events **after** successful S3 write; billing service aggregates monthly per `(orgId, filterId, version)`. Marketplace purchases write **entitlement records** checked before enqueue.

**Rationale:** Decouples payments from execution path; supports refunds, disputes, and vendor payouts without reprocessing images. Failed invocations still log for SLOs but may not bill.

---

#### 6. Sync vs async routing for marketplace filters

**Problem:** Customers still expect fast UX on single-image flow.

**Alternatives considered:**
- All marketplace filters async only (simple, slower UX).
- **Sync allowed** only if manifest `maxDurationSec` &lt; threshold (e.g. 25s) and filter on allowlist; else async job.

**Decision:** Proxy Lambda checks entitlement + manifest → invoke Filter Runner **synchronously** when within budget, else create job and return `202` + poll URL (same job machinery as Scenario A).

**Rationale:** Reuses bulk infrastructure for slow vendors without blocking the core product. Clear SLO per filter in manifest.

---

### Scenario B — End-state sketch

```
Developer → portal → S3 artifact + DynamoDB FILTER#id/VERSION#x.y.z
Customer purchase → entitlement on ORG#
POST /images or worker → Proxy (auth, entitlement) → Filter Runner (vendor sandbox)
                      → usage event → billing pipeline
```

**Incremental path:** (1) internal filters refactored to Host contract, (2) one pilot third-party filter as Lambda container, (3) registry + approval, (4) metering + payouts, (5) async fallback.

---

## Cross-cutting themes

| Principle | Application |
|-----------|-------------|
| **Incrementalism** | Keep `POST /images` and Proxy Lambda; add jobs, queues, and Filter Runner alongside. |
| **Operational reality** | `jobId`, `imageId`, `filterId@version` in every log line; DLQ dashboards; S3 keys deterministic for replay. |
| **Simplicity** | SQS + Lambda workers before Step Functions; container-per-filter before a custom plugin OS. |
| **Single table** | Extend with `JOB#`, `PIPELINE#`, `FILTER#`, `ENTITLEMENT#` SK patterns—no second database for v1. |

---

## Summary

| Scenario | Core shift | Main new components |
|----------|------------|---------------------|
| **A — Bulk** | Sync → async jobs; base64 → presigned S3; one filter → pipeline spec | Job API, SQS workers, per-image status, optional higher size limit |
| **B — Marketplace** | In-process Sharp → sandboxed Filter Runner with stable S3 contract | Registry, semver artifacts, entitlements, usage events, sync/async routing |

Both scenarios extend the existing serverless spine (API Gateway, Lambda, S3, DynamoDB) rather than replacing it—reducing migration risk for ~1,000 production organizations.
