import { closePosition } from "@backend/services/pipeline.js";

export async function POST() {
  try {
    const result = await closePosition();
    return Response.json(result);
  } catch (error) {
    console.error("[api/close] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
