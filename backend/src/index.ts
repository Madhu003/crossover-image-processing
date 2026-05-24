import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { DynamoDBSchemaError } from "./storage/dynamodb.js";
import { imagesRouter } from "./routes/images.js";
import { db } from "./storage/dynamodb.js";
import { s3 } from "./storage/s3.js";

async function main(): Promise<void> {
  await db.init();
  await s3.init();

  const app = express();

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    }),
  );
  app.use(express.json({ limit: "6mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "aperture",
      storage: {
        s3Bucket: config.aws.s3Bucket,
        dynamoTable: config.aws.dynamoTable,
        region: config.aws.region,
      },
    });
  });

  app.use("/images", imagesRouter);

  app.use(
    (
      err: Error & { type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err.type === "entity.too.large") {
        res.status(413).json({ error: "Request body too large" });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  app.listen(config.port, () => {
    console.log(`Aperture API listening on ${config.publicBaseUrl}`);
    console.log(`  POST ${config.publicBaseUrl}/images`);
    console.log(`  S3 bucket: ${config.aws.s3Bucket}`);
    console.log(`  DynamoDB table: ${config.aws.dynamoTable}`);
    console.log(`  Default org: ${config.defaultOrganizationId}`);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  if (error instanceof DynamoDBSchemaError) {
    console.error("\nHint: npm run setup:dynamo:recreate");
  }
  process.exit(1);
});
