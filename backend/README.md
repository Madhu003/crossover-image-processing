# Aperture Backend

Express API with **AWS S3** (images) and **single-table DynamoDB** (metadata).

## Single-table data model

| Entity | pk | sk |
|--------|----|----|
| User | `USER#<userId>` | `PROFILE` |
| Organization | `ORG#<organizationId>` | `METADATA` |
| Image | `ORG#<organizationId>` | `IMAGE#<imageId>` |

Demo tenant (no login): `user-demo-001` / `org-demo-001`.

## Setup

```bash
npm install
cp .env.example .env
npm run setup:dynamo
npm run dev
```

Wrong table schema (old `imageId`-only key)? Run `npm run setup:dynamo:recreate`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Express on :3000 |
| `npm run setup:dynamo` | Create table + seed user/org |
| `npm run seed` | Re-seed user/org |
| `npm run build` | Compile TypeScript |

## Endpoints

- `GET /health`
- `POST /images` — JSON `{ image, filter?, organizationId? }`
