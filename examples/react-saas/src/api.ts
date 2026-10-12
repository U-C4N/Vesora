export interface TrendRow {timestamp: number; revenue: number; expansion: number; activeUsers: number}
export interface PlanRow {plan: string; retained: number; newAccounts: number}
export interface AccountRow {id: string; name: string; plan: string; seats: number; revenue: number; sessions: number}
export interface DashboardData {trend: TrendRow[]; plans: PlanRow[]; accounts: AccountRow[]; revision: number}

/** Deterministic synthetic fixtures: replace this with your application's API. */
export function createDashboard(revision = 0): DashboardData {
  const end = Date.UTC(2026, 9, 12);
  const trend = Array.from({length: 90}, (_, i) => ({
    timestamp: end - (89 - i) * 86_400_000,
    revenue: Math.round(8600 + i * 63 + Math.sin(i / 4) * 330 + revision * 145),
    expansion: Math.round(1700 + i * 18 + Math.cos(i / 6) * 140 + revision * 45),
    activeUsers: Math.round(1140 + i * 16 + Math.sin(i / 5) * 90 + revision * 12),
  }));
  const plans = ['Starter', 'Pro', 'Business'].map((plan, i) => ({plan, retained: 240 - i * 55 + revision * 2, newAccounts: 32 + i * 14 + revision}));
  const accounts = Array.from({length: 24}, (_, i) => ({
    id: `account-${i + 1}`, name: ['Aster', 'Northwind', 'Cedar', 'Orbit', 'Atlas', 'Lumen'][i % 6] + ` ${Math.floor(i / 6) + 1}`,
    plan: ['Starter', 'Pro', 'Business'][i % 3], seats: 3 + (i * 7) % 54,
    sessions: 12 + (i * 19) % 230 + revision * 2,
    revenue: 150 + ((i * 173) % 1700) + revision * 20,
  }));
  return {trend, plans, accounts, revision};
}

export function fetchDashboard(revision: number, signal: AbortSignal, fail = false): Promise<DashboardData> {
  return new Promise((resolve, reject) => {
    const abort = () => {clearTimeout(timer); reject(new DOMException('Request cancelled', 'AbortError'));};
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      if (fail) reject(new Error('The demo API request failed. Turn off the failure switch and refresh.'));
      else resolve(createDashboard(revision));
    }, 500);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
  });
}
