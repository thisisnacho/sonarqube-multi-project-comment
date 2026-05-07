import { describe, expect, it } from "vitest";
import { overallQualityGate, renderComment, type RenderOptions } from "./comment.js";
import type { ProjectResult } from "./types.js";

const cloudOpts: RenderOptions = {
  header: "SonarQube PR analysis",
  iconBaseUrl: "https://icons.example.com/v2",
  iconStyle: "cloud",
};

function passingResult(overrides: Partial<ProjectResult> = {}): ProjectResult {
  return {
    label: "alpha",
    projectKey: "demo-alpha",
    qualityGate: "OK",
    analyzed: true,
    issues: { new: 0, accepted: 0 },
    newSecurityHotspots: 0,
    newCoverage: 85.3,
    coverage: 80,
    newDuplications: 0,
    duplications: 0,
    dashboardUrl: "https://sonar.example.com/dashboard?id=demo-alpha&pullRequest=42",
    ...overrides,
  };
}

describe("renderComment", () => {
  it("renders the header and table columns", () => {
    const out = renderComment([passingResult()], cloudOpts);
    expect(out).toContain("## SonarQube PR analysis");
    expect(out).toContain("| Project | Gate | Issues | Sec. | Coverage | Duplications |");
  });

  it("renders an unanalysed project as 'Not analyzed'", () => {
    const out = renderComment([passingResult({ analyzed: false })], cloudOpts);
    expect(out).toMatch(/\| Not analyzed \| - \| - \| - \| - \|/);
  });

  it("uses qg-{state}-20px badge for cloud icon style", () => {
    const out = renderComment([passingResult()], cloudOpts);
    expect(out).toContain("checks/QualityGateBadge/qg-passed-20px.png");
    expect(out).not.toContain("qg-passed-16px");
  });

  it("uses {state}-16px badge for community-plugin icon style", () => {
    const out = renderComment([passingResult()], { ...cloudOpts, iconStyle: "community-plugin" });
    expect(out).toContain("checks/QualityGateBadge/passed-16px.png");
    expect(out).not.toContain("qg-passed-");
  });

  it("links the New issues cell to the new-code period", () => {
    const out = renderComment([passingResult()], cloudOpts);
    expect(out).toContain("issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true");
  });

  it("uses the plural issueStatuses parameter for accepted", () => {
    const out = renderComment([passingResult()], cloudOpts);
    expect(out).toContain("issueStatuses=ACCEPTED");
    expect(out).not.toContain("issueStatus=ACCEPTED");
  });

  it("links security hotspots under /project/security_hotspots", () => {
    const out = renderComment([passingResult()], cloudOpts);
    expect(out).toContain("/project/security_hotspots?id=demo-alpha");
  });

  it("renders the footer when provided", () => {
    const out = renderComment([passingResult()], { ...cloudOpts, footer: "powered by tests" });
    expect(out).toContain("<sub>powered by tests</sub>");
  });

  it("omits the footer when not provided", () => {
    const out = renderComment([passingResult()], cloudOpts);
    expect(out).not.toContain("<sub>");
  });

  it("renders one row per project", () => {
    const out = renderComment(
      [
        passingResult({ label: "alpha" }),
        passingResult({ label: "beta", projectKey: "demo-beta" }),
      ],
      cloudOpts,
    );
    const rowCount = (out.match(/^\| <a href=/gm) ?? []).length;
    expect(rowCount).toBe(2);
  });
});

describe("overallQualityGate", () => {
  it("returns NONE for an empty list", () => {
    expect(overallQualityGate([])).toBe("NONE");
  });

  it("returns OK when every project passes", () => {
    expect(overallQualityGate([passingResult(), passingResult({ label: "b" })])).toBe("OK");
  });

  it("returns ERROR if any project fails", () => {
    expect(
      overallQualityGate([passingResult(), passingResult({ qualityGate: "ERROR" })]),
    ).toBe("ERROR");
  });

  it("preserves a non-OK status when no ERROR is present", () => {
    expect(overallQualityGate([passingResult({ qualityGate: "WARN" })])).toBe("WARN");
  });
});
