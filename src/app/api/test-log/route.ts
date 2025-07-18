export async function GET() {
    console.debug("[Server Test] API endpoint called");
    return Response.json({ message: "Test log endpoint" });
} 