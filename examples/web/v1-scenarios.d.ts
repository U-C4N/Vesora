import type * as Core from '@vesora/core/runtime';
export const workspaceNames: readonly string[];
export const datasetNames: readonly string[];
export interface CohortRow {id: string; group: string; latency: number; cost: number; quality: number}
export interface Workspace {
  kind: string; dataset: string; figure: Core.Figure; summary: string; timeMax: number;
  comparison?: Core.RunComparison; controller?: Core.ObservationController;
  setWindow?(end: number, width?: number): void;
  append?(): Promise<{timeMax: number; retained: number}>;
  queryRows?(offset?: number): Core.ObservationPage & {rows: CohortRow[]};
  selectHigh?(): void; clear?(): void; dispose(): void;
}
export function createWorkspace(core: typeof Core, kind?: string, dataset?: string): Workspace;
