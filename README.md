# Aperture — Image Processing MVP

**Node/TypeScript backend** (Express, AWS S3 + DynamoDB) and **React/TypeScript frontend** for synchronous image upload and filtering.

## Project structure

```
backend/     # Express API — http://localhost:3000
frontend/    # React app — http://localhost:5173
```

## Prerequisites

- Node.js 20+

## Quick start

**Backend** (terminal 1):

```bash
cd backend
npm install
npm run setup:dynamo
npm run dev
```

**Frontend** (terminal 2):

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, choose an image (≤ 4.5 MB), pick a filter, and click **Apply filter**.

## Configuration

| App | File | Key settings |
|-----|------|----------------|
| Backend | `backend/.env` | `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_DYNAMODB_TABLE` |
| Frontend | `frontend/.env` | `VITE_API_URL` (default `http://localhost:3000`) |

## Flow

### Single image (sync)

1. User selects an image (max **4.5 MB**).
2. Frontend base64-encodes and `POST`s to `/images`.
3. Backend stores files in S3 and metadata in DynamoDB.
4. Response includes `processedUrl` (presigned S3 link).

### Bulk jobs (async)

1. User selects multiple images and a multi-step filter pipeline on **Bulk jobs**.
2. Frontend `POST`s to `/jobs` → receives `jobId` immediately (**202**).
3. Backend enqueues background processing (in-process worker locally; SQS in production).
4. Job status page long-polls `GET /jobs/:jobId?wait=true&includeImages=true` until terminal.

| Endpoint | Description |
|----------|-------------|
| `POST /jobs` | Create async bulk job |
| `GET /jobs/:jobId` | Job status (`?wait=true` for long polling) |
| `GET /jobs/:jobId/images` | Per-image status list |

## Architecture scenarios

Design notes: [`docs/architecture-scenarios.md`](docs/architecture-scenarios.md).
