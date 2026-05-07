import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFromProjects, loadFromReportTaskFiles, parseProjectsInput } from "./sources.js";
import type { SonarClient } from "./sonar.js";
import type { ProjectResult } from "./types.js";

vi.mock("@actions/glob", () => ({
  create: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const glob = await import("@actions/glob");
const fs = await import("node:fs/promises");

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

describe("loadFromReportTaskFiles", () => {
  beforeEach(() => {
    vi.mocked(glob.create).mockReset();
    vi.mocked(fs.readFile).mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeClient(): SonarClient {
    return {
      fetchProject: vi
        .fn()
        .mockImplementation(
          async (label: string, key: string) =>
            ({ label, projectKey: key, qualityGate: "OK" }) as unknown as ProjectResult,
        ),
      waitForCeTask: vi.fn().mockResolvedValue(undefined),
    } as unknown as SonarClient;
  }

  it("returns empty array for blank pattern", async () => {
    const client = makeClient();
    expect(await loadFromReportTaskFiles(client, "   ", "1", true)).toEqual([]);
    expect(glob.create).not.toHaveBeenCalled();
  });

  it("warns and returns empty when no files match", async () => {
    vi.mocked(glob.create).mockResolvedValue({ glob: async () => [] } as never);
    const client = makeClient();
    expect(await loadFromReportTaskFiles(client, "missing/**", "1", true)).toEqual([]);
  });

  it("reads each report-task, awaits the CE task, and fetches results", async () => {
    vi.mocked(glob.create).mockResolvedValue({
      glob: async () => ["/tmp/a/report-task.txt", "/tmp/b/report-task.txt"],
    } as never);
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const key = String(path).includes("/a/") ? "p-a" : "p-b";
      const id = String(path).includes("/a/") ? "task-a" : "task-b";
      return `projectKey=${key}\nceTaskId=${id}\n`;
    });

    const client = makeClient();
    const results = await loadFromReportTaskFiles(client, "**/report-task.txt", "42", true);

    expect(results).toHaveLength(2);
    expect(client.waitForCeTask).toHaveBeenCalledTimes(2);
    expect(client.waitForCeTask).toHaveBeenCalledWith("task-a");
    expect(client.waitForCeTask).toHaveBeenCalledWith("task-b");
    expect(client.fetchProject).toHaveBeenCalledWith("p-a", "p-a", "42");
    expect(client.fetchProject).toHaveBeenCalledWith("p-b", "p-b", "42");
  });

  it("skips report-task files that fail to parse", async () => {
    vi.mocked(glob.create).mockResolvedValue({
      glob: async () => ["/tmp/bad/report-task.txt", "/tmp/good/report-task.txt"],
    } as never);
    vi.mocked(fs.readFile).mockImplementation(async (path) =>
      String(path).includes("/bad/") ? "no required keys" : "projectKey=p\nceTaskId=t\n",
    );

    const client = makeClient();
    const results = await loadFromReportTaskFiles(client, "**/report-task.txt", "1", true);
    expect(results).toHaveLength(1);
    expect(client.fetchProject).toHaveBeenCalledTimes(1);
  });

  it("does not wait for CE task when waitForTask is false", async () => {
    vi.mocked(glob.create).mockResolvedValue({
      glob: async () => ["/tmp/a/report-task.txt"],
    } as never);
    vi.mocked(fs.readFile).mockResolvedValue("projectKey=p\nceTaskId=t\n");

    const client = makeClient();
    await loadFromReportTaskFiles(client, "**/report-task.txt", "1", false);
    expect(client.waitForCeTask).not.toHaveBeenCalled();
    expect(client.fetchProject).toHaveBeenCalledOnce();
  });

  it("continues even if CE wait throws", async () => {
    vi.mocked(glob.create).mockResolvedValue({
      glob: async () => ["/tmp/a/report-task.txt"],
    } as never);
    vi.mocked(fs.readFile).mockResolvedValue("projectKey=p\nceTaskId=t\n");
    const client = makeClient();
    (client.waitForCeTask as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));

    const results = await loadFromReportTaskFiles(client, "**/report-task.txt", "1", true);
    expect(results).toHaveLength(1);
    expect(client.fetchProject).toHaveBeenCalledOnce();
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
