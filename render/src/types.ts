export type QualityGateStatus = "OK" | "ERROR" | "WARN" | "NONE" | "UNKNOWN";

export interface ProjectInput {
  label: string;
  key: string;
}

export interface IssueCounts {
  new: number | null;
  fixed: number | null;
  accepted: number | null;
}

export interface ProjectResult {
  label: string;
  projectKey: string;
  qualityGate: QualityGateStatus;
  analyzed: boolean;
  issues: IssueCounts;
  newSecurityHotspots: number | null;
  newCoverage: number | null;
  coverage: number | null;
  newDuplications: number | null;
  duplications: number | null;
  dashboardUrl: string;
  error?: string;
}

export interface SonarConfig {
  hostUrl: string;
  token: string;
  iconBaseUrl: string;
}

export interface ReportTask {
  projectKey: string;
  serverUrl?: string;
  dashboardUrl?: string;
  ceTaskId: string;
  ceTaskUrl?: string;
}
