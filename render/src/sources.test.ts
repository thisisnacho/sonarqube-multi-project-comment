import { describe, expect, it, vi } from "vitest";
import { loadFromProjects, parseProjectsInput } from "./sources.js";
import type { SonarClient } from "./sonar.js";
import type { ProjectResult } from "./types.js";

describe("parseProjectsInput", () => {
  it("returns empty array for blank input", () => {
    expect(parseProjectsInput("")).toEqual([]);
    expect(parseProjectsInput("   ")).toEqual([]);
    expect(parseProjectsInput("\n\n")).toEqual([]);
  });

  it("parses LABEL|KEY pairs", () => {
    expect(parseProjectsInput("frontend|acme-frontend")).toEqual([
      { label: "frontend", key: "acme-frontend" },
    ]);
  });

  it("uses key as label when no pipe", () => {
    expect(parseProjectsInput("acme-frontend")).toEqual([
      { label: "acme-frontend", key: "acme-frontend" },
    ]);
  });

  it("splits on newlines and commas", () => {
    expect(parseProjectsInput("a|x\nb|y, c|z")).toEqual([
      { label: "a", key: "x" },
      { label: "b", key: "y" },
      { label: "c", key: "z" },
    ]);
  });

  it("trims whitespace around labels and keys", () => {
    expect(parseProjectsInput("  frontend  |  acme-frontend  ")).toEqual([
      { label: "frontend", key: "acme-frontend" },
    ]);
  });

  it("skips empty lines between entries", () => {
    expect(parseProjectsInput("a|x\n\n\nb|y")).toEqual([
      { label: "a", key: "x" },
      { label: "b", key: "y" },
    ]);
  });
});

describe("loadFromProjects", () => {
  it("calls fetchProject for each project with the same PR number", async () => {
    const fetchProject = vi
      .fn<SonarClient["fetchProject"]>()
      .mockImplementation(async (label, key) => {
        return { label, projectKey: key, qualityGate: "OK" } as unknown as ProjectResult;
      });
    const client = { fetchProject } as unknown as SonarClient;

    const results = await loadFromProjects(
      client,
      [
        { label: "alpha", key: "p-alpha" },
        { label: "beta", key: "p-beta" },
      ],
      "42",
    );

    expect(results).toHaveLength(2);
    expect(fetchProject).toHaveBeenCalledTimes(2);
    expect(fetchProject).toHaveBeenNthCalledWith(1, "alpha", "p-alpha", "42");
    expect(fetchProject).toHaveBeenNthCalledWith(2, "beta", "p-beta", "42");
  });
});
