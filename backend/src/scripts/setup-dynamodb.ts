import "../config.js";
import { DEMO_ORG_ID, DEMO_USER_ID } from "../storage/demoTenant.js";
import { db } from "../storage/dynamodb.js";

const recreate =
  process.argv.includes("--recreate") ||
  process.env.FORCE_RECREATE_DYNAMODB_TABLE === "true";

/**
 * Creates single-table DynamoDB (pk + sk) and seeds hardcoded User + Organization.
 * Use --recreate if the table still has the old imageId-only key.
 */
async function main(): Promise<void> {
  if (recreate) {
    console.log("Recreate mode: will replace table if key schema is wrong.");
  }

  await db.init({ recreateTable: recreate });

  console.log("DynamoDB setup complete.");
  console.log("  Table:", process.env.AWS_DYNAMODB_TABLE);
  console.log("  Keys: pk (HASH) + sk (RANGE)");
  console.log("  Seeded user:", DEMO_USER_ID);
  console.log("  Seeded org:", DEMO_ORG_ID);
  console.log("  Image items: ORG#<orgId> / IMAGE#<imageId>");
}

main().catch((error) => {
  console.error("DynamoDB setup failed:", error);
  process.exit(1);
});
