export const dynamic = "force-dynamic";

export async function POST() {
  const { openPosition } = await import("@backend/services/pipeline");
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
