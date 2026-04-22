/**
 * index.ts — CLI entry point.
 *
 * Usage:
 *   npx tsx src/index.ts open    # openPosition
 *   npx tsx src/index.ts close   # closePosition
 */

import { openPosition, closePosition } from "./services/pipeline.js";

const [, , command] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "open": {
      console.log("[index] Running openPosition …");
      const result = await openPosition();
      console.log("[index] openPosition done:", JSON.stringify(result, null, 2));
      break;
    }
    case "close": {
      console.log("[index] Running closePosition …");
      const result = await closePosition();
      console.log("[index] closePosition done:", JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error("Usage: tsx src/index.ts <open|close>");
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[index] Fatal error:", err);
  process.exit(1);
});
