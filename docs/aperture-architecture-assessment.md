# Aperture Architecture Assessment — [Your Name]

---

## Scenario A: Bulk Processing Pipeline

### Important Facts

- **API Gateway and Lambda have hard timeouts** (~30s at the gateway; Lambda max 15 min). A synchronous `POST /images` cannot stretch to minutes or hours — bulk processing must become async jobs.
- **Base64-in-JSON does not scale** for hundreds of large files (payload size, memory, cost). Upload path must move to **direct-to-S3** (presigned URLs / multipart).
- **Power users already stress flat-rate economics.** Bulk jobs need metering (image count, GB, pipeline steps) even if billing is out of scope for this design.
- **S3 + DynamoDB single-table design already fits org-scoped access.** Extend with `JOB#` / `PIPELINE#` entities rather than a new database.
- **Processing is CPU/memory bound** (Sharp today). Multi-step pipelines multiply work; workers need right-sized compute separate from the thin API Lambda.
- **Partial failure is expected at scale.** Must support per-image status, retries, and resumability — not all-or-nothing in one Lambda invocation.
- **4.5 MB cap exists on the sync path.** Keep the limit for `POST /images`; allow a higher cap on the presigned bulk path for enterprise tier.

### Important Technical Decisions

#### Decision 1: Async job model instead of extending the sync API
- **Problem:** Hundreds of images × multiple filters cannot complete inside one HTTP request or one Proxy Lambda call.
- **Alternatives:** Keep `POST /images` with long timeouts (blocks connections, brittle); WebSockets for progress (more moving parts); job + queue + workers with `POST /jobs` returning `jobId` immediately.
- **Decision:** Introduce **Bulk Job API** (`POST /jobs`, `GET /jobs/:id`, optional `GET /jobs/:id/images`) while keeping `POST /images` for single-image UX.
- **Rationale:** Minimal break for current customers; enterprise bulk is new access pattern. Jobs map to DynamoDB (`status`, `progress`, `failedCount`); easy to debug in CloudWatch by `jobId`.

#### Decision 2: Presigned S3 multipart uploads for ingest

- **Problem:** How do users upload hundreds of large images without hitting API payload and timeout limits?
- **Alternatives:** Continue base64 through API (fails immediately); proxy bytes through Lambda (expensive, timeout risk); client → S3 via presigned POST/multipart; API only issues URLs and records metadata.
- **Decision:** `POST /jobs` creates job → API returns per-file or batch presigned upload URLs → client uploads to `s3://…/jobs/{jobId}/original/{imageId}` → S3 event enqueues processing.
- **Rationale:** Reuses existing S3; API stays small. Multipart handles large files. Same pattern works for desktop agents later.

#### Decision 3: Pipeline definition as versioned JSON, executed by worker chain

- **Problem:** How to model filter A → B → C maintainable per enterprise?
- **Alternatives:** Hard-code pipelines (unmaintainable); declarative spec on job (`steps: [{ filterId, params }]`); Step Functions ASL per customer (heavy ops).
- **Decision:** Store **`pipelineVersion` + `steps[]`** on job in DynamoDB. Pipeline Executor runs steps sequentially per image; intermediate artifacts to S3 when needed.
- **Rationale:** JSON spec is easy to validate, audit, and expose in UI. Executor testable locally. Step Functions can orchestrate job-level fan-out later without encoding every filter in ASL.

#### Decision 4: SQS + worker pool for fan-out

- **Problem:** Processing minutes to hours; scale and isolate failures?
- **Alternatives:** Single long-running Lambda looping 500 images (blast radius, no parallelism); **SQS queue** one message per `(jobId, imageId)`; Step Functions Map (good, cost/complexity for v1 bulk).
- **Decision:** On upload complete, enqueue **one SQS message per image**. Workers run pipeline, update **per-image row** in DynamoDB (`pending | processing | completed | failed`), increment job counters atomically.
- **Rationale:** Simple ops (DLQ, visibility timeout). Scale workers horizontally. Incremental rollout: Lambda consumers; Fargate if Sharp + multi-step exceeds Lambda limits.

#### Decision 5: Per-image retry + job-level terminal state

- **Problem:** What if processing fails partway through bulk job?
- **Alternatives:** Fail entire job (bad UX 499/500); retry whole job (wasteful); **per-image retries** (SQS redrive, max attempts) + `completed_with_errors`.
- **Decision:** Idempotent worker keyed by `(jobId, imageId)`; deterministic S3 keys. Failed images: `failedReason` on image record; optional `POST /jobs/:id/retry-failed`. Job completes when all images terminal; counts in `GET /jobs/:id`.
- **Rationale:** Matches enterprise bulk (stragglers). Idempotency prevents duplicate S3 objects on retry.

#### Decision 6: Raise size limits only on bulk path

- **Problem:** 4.5 MB cap exists for sync product limitation.
- **Alternatives:** Same cap on bulk (blocks enterprise); **higher cap on presigned bulk path** (50–100 MB) with org/feature flag; raise everywhere (regression risk on sync path).
- **Decision:** Keep **4.5 MB for `POST /images`**; allow **higher cap on presigned bulk path** (e.g. 50–100 MB) with org/feature flag.
- **Rationale:** Avoids regressing simple path; enterprise tier opts into different constraints and infrastructure cost.

---

## Scenario B: Third-Party Filter Marketplace

### Important Facts

- **Third-party code is untrusted.** Must **isolate** execution; never run vendor code in the Proxy Lambda process.
- **Filters are versioned products.** Breaking API changes hurt paying customers; need **semver + deprecation policy**.
- **Billing/revenue share implies auditability.** Every filter invocation needs a **durable usage event** (who, which filter version, org, outcome).
- **Today's filter is in-process Sharp.** Marketplace filters need a **stable host contract** (inputs/outputs on S3), not shared memory.
- **Sync path may still exist for simple filters.** Platform filters on hot path need **timeout budgets** and async fallback for slow vendors.
- **~1,000 orgs, growing.** Registry and metering can start simple (DynamoDB + S3 artifacts); avoid Kubernetes-for-day-one.

### Important Technical Decisions

#### Decision 1: Filter Host contract — S3 in, S3 out, JSON config

- **Problem:** What is the API between Aperture and third-party filters?
- **Alternatives:** Pass raw pixels in Lambda event (size limits); gRPC streaming (complex for indie devs); **canonical contract:** `inputS3Uri`, `outputS3Prefix`, `params`, `context` (orgId, imageId) → `status` + `outputS3Uri` + metadata.
- **Decision:** Publish **Filter Host Protocol (v1):** worker downloads input from S3, invokes filter in sandbox, uploads output, returns structured result. First-party Sharp filters implement same interface internally.
- **Rationale:** Same contract for sync and bulk workers. Vendors test locally with MinIO + CLI. No dependency on our DynamoDB schema inside their code.

#### Decision 2: Sandboxed execution via Filter Runner Lambdas

- **Problem:** How to isolate third-party code from core?
- **Alternatives:** `vm2` / `isolated-vm` in Proxy (insufficient); **per-filter Lambda** deployed from CI (strong isolation); **single Filter Runner** container per filter (Fargate/Lambda container) IAM-scoped credentials.
- **Decision (phased):** Vendor submits **container image** (or zip) → deploy **dedicated Lambda per filter major version** with minimal IAM (read input prefix, write output prefix, no VPC DB).
- **Rationale:** Lambda per filter = blast-radius isolation, independent timeouts/memory. Proxy only routes metadata — never loads vendor code. Ops cost predictable; Step Functions not required v1.

#### Decision 3: Filter registry in DynamoDB + artifacts in S3

- **Problem:** How do developers submit and deploy filters?
- **Alternatives:** Git-only (no marketplace UX); **registry table** `FILTER#<filterId>` / `VERSION#<semver>` manifest, pricing, approval; artifact `s3://filters/{id}/{version}/`; public npm (supply-chain risk).
- **Decision:** Developer portal → upload artifact + manifest → **automated validation** (lint contract, scan, smoke test) → approval → deploy to Filter Runner.
- **Rationale:** Reuses single-table (`ORG#` subscriptions link org to purchased `filterId@version`). S3 immutable versions; DynamoDB metadata and entitlement.

#### Decision 4: Versioning — immutable semver, deprecation, runtime pinning

- **Problem:** Versioning, deprecation, breaking changes?
- **Alternatives:** Floating `latest` only (breaks pipelines); **immutable versions**, jobs pin `filterId@1.2.0`, deprecation date, new jobs default latest **approved** minor.
- **Decision:** Manifest `protocolVersion`, `entrypoint`, `memoryMb`, `timeoutSec`. Breaking protocol → new `protocolVersion` + Host adapter. Orgs **pin** versions in pipelines; bulk jobs snapshot at creation.
- **Rationale:** Enterprise pipelines don't change when vendor ships v2. Support reproduces bugs with exact version + S3 inputs.

#### Decision 5: Entitlements and usage metering as first-class events

- **Problem:** What does billing/revenue share require technically?
- **Alternatives:** Aggregate CloudWatch logs (fragile); **usage event stream** each invocation `{ orgId, filterId, version, imageId, durationMs, outcome }` → Kinesis → durable store.
- **Decision:** Filter Runner emits events **after** successful S3 write; billing aggregates monthly per `(orgId, filterId, version)`. Purchases write **entitlement records** checked before enqueue.
- **Rationale:** Decouples payments from execution; refunds, disputes, vendor payouts without reprocessing. Failed invocations log for SLOs; may not bill.

#### Decision 6: Sync vs async routing for marketplace filters

- **Problem:** Customers expect fast UX on single-image flow with marketplace filters.
- **Alternatives:** All marketplace async only (simple, slower UX); **sync allowed** only if manifest `maxDurationSec` < threshold (e.g. 25s) and allowlist; else async job.
- **Decision:** Proxy checks entitlement + manifest → invoke Filter Runner **synchronously** when within budget, else create job and return `202` + poll URL (Scenario A machinery).
- **Rationale:** Reuses bulk infrastructure for slow vendors without blocking core product. Clear SLO per filter in manifest.
