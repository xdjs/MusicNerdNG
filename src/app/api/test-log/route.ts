export async function GET() {
    console.log("[Server Test] API endpoint called");
    return Response.json({ message: "Test log endpoint" });
} 