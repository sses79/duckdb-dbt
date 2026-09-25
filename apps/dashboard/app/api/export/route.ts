import { handleDashboardCsv } from '../../../../../src/dashboard/http.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleDashboardCsv(request, process.env);
}
