import "../config.js";
import { DEMO_ORG_ID, DEMO_USER_ID } from "../storage/demoTenant.js";
import { db } from "../storage/dynamodb.js";

/** Re-seed hardcoded user + organization (same as setup-dynamodb). */
async function main(): Promise<void> {
  if (process.env.DYNAMODB_AUTO_CREATE !== "false") {
    process.env.DYNAMODB_AUTO_CREATE = "true";
  }
  await db.init();

  console.log("Seed complete:");
  console.log(`  userId: ${DEMO_USER_ID}`);
  console.log(`  organizationId: ${DEMO_ORG_ID}`);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
