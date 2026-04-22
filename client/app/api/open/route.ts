import { openPosition } from "@backend/services/pipeline.js";

export async function POST() {
  try {
    const result = await openPosition();
    return Response.json(result);
  } catch (error) {
    console.error("[api/open] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
