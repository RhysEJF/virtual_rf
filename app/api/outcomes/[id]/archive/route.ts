import { NextResponse } from "next/server";
import { updateOutcome, getOutcomeById } from "@/lib/db/outcomes";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: Request,
  { params }: Params
): Promise<NextResponse> {
  const { id } = await params;

  // Verify outcome exists
  const existing = getOutcomeById(id);
  if (!existing) {
    return NextResponse.json({ error: "Outcome not found" }, { status: 404 });
  }

  const outcome = updateOutcome(id, { status: "archived" });
  return NextResponse.json({ outcome, message: "Outcome archived successfully" });
}
