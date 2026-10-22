import { HealthResponseSchema, type HealthResponse } from '@erp/contracts';

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/api/v1';

/** GET /health, checked against the shared contract. */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE}/health`);
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return HealthResponseSchema.parse(await response.json());
}
