import { NextRequest, NextResponse } from 'next/server';
import { getExperiments } from '@/lib/db/experiments';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const { id: outcomeId } = await params;

  const taskId = request.nextUrl.searchParams.get('task_id');
  const keptParam = request.nextUrl.searchParams.get('kept');

  const experiments = getExperiments({
    outcomeId,
    taskId: taskId || undefined,
    kept: keptParam !== null ? keptParam === 'true' : undefined,
  });

  return NextResponse.json({ experiments });
}
