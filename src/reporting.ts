import type { FlowRunState, FlowScenario } from "./types";

export const LOCAL_REPORT_HISTORY_KEY = "fiber-wasm-report-history";
export const MAX_LOCAL_REPORTS = 40;
export const REPORT_SCHEMA_VERSION = 1;

export type ReportSource = "browser" | "ci";
export type ReportStatus = "success" | "failed" | "running";

export interface FlowReportSummary {
  runId: string;
  scenario: FlowScenario;
  status: ReportStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  lastError?: string;
}

export interface FlowStepDuration {
  id: string;
  label: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  durationSeconds?: number;
}

export interface FlowReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  generatedAt: string;
  source: ReportSource;
  summary: FlowReportSummary;
  steps: FlowStepDuration[];
}

export interface ReportIndexEntry extends FlowReportSummary {
  generatedAt: string;
  source: ReportSource;
  file?: string;
}

export interface ReportIndex {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  updatedAt: string;
  reports: ReportIndexEntry[];
}

export function createFlowReport(state: FlowRunState, source: ReportSource): FlowReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source,
    summary: summarizeFlowState(state),
    steps: state.steps.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.status,
      startedAt: step.startedAt,
      endedAt: step.endedAt,
      durationMs: step.durationMs,
      durationSeconds:
        step.durationMs === undefined ? undefined : Number((step.durationMs / 1000).toFixed(3))
    }))
  };
}

export function summarizeFlowState(state: FlowRunState): FlowReportSummary {
  return {
    runId: state.runId,
    scenario: state.scenario,
    status: state.running ? "running" : state.lastError ? "failed" : "success",
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    durationMs:
      state.startedAt && state.endedAt
        ? new Date(state.endedAt).getTime() - new Date(state.startedAt).getTime()
        : undefined,
    lastError: state.lastError
  };
}

export function createReportIndexEntry(report: FlowReport, file?: string): ReportIndexEntry {
  return {
    ...report.summary,
    generatedAt: report.generatedAt,
    source: report.source,
    file
  };
}

export function reportFileName(report: FlowReport): string {
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  return `${timestamp}-${report.summary.scenario}-${report.summary.runId}.json`;
}

export function readLocalReportHistory(): FlowReport[] {
  const rawReports = localStorage.getItem(LOCAL_REPORT_HISTORY_KEY);
  if (!rawReports) {
    return [];
  }

  try {
    const reports = JSON.parse(rawReports);
    return Array.isArray(reports) ? (reports as FlowReport[]) : [];
  } catch {
    localStorage.removeItem(LOCAL_REPORT_HISTORY_KEY);
    return [];
  }
}

export function saveLocalFlowReport(report: FlowReport): FlowReport[] {
  const reports = [
    report,
    ...readLocalReportHistory().filter((item) => item.summary.runId !== report.summary.runId)
  ].slice(0, MAX_LOCAL_REPORTS);

  localStorage.setItem(LOCAL_REPORT_HISTORY_KEY, JSON.stringify(reports));
  return reports;
}
