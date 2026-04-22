export const dynamic = "force-dynamic";

export async function POST() {
  const { closePosition } = await import("@backend/services/pipeline");
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
