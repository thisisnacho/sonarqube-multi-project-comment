import { describe, expect, it, vi } from "vitest";
import { SonarClient, type SonarClientDeps } from "./sonar.js";

const config = {
  hostUrl: "https://sonar.example.com/",
  token: "tok",
};

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), { status: 200 });
}

function fail(status = 500): Response {
  return new Response("nope", { status });
}

function makeDeps(fetchImpl: typeof fetch): SonarClientDeps {
  return {
    fetch: fetchImpl,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SonarClient", () => {
  it("strips trailing slashes from hostUrl", () => {
    const client = new SonarClient(config, makeDeps(vi.fn()));
    expect(client.hostUrl).toBe("https://sonar.example.com");
  });

  it("sends Basic auth derived from the token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok({ projectStatus: { status: "NONE" } }));
    const client = new SonarClient(config, makeDeps(fetchMock));
    await client.fetchProject("a", "p", "1");

    const [, init] = fetchMock.mock.calls[0]!;
    const expected = `Basic ${Buffer.from("tok:").toString("base64")}`;
    expect((init?.headers as Record<string, string>).Authorization).toBe(expected);
  });

  it("returns NONE / not-analysed when quality gate is missing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok({ projectStatus: { status: "NONE" } }));

    const client = new SonarClient(config, makeDeps(fetchMock));
    const result = await client.fetchProject("alpha", "p-alpha", "42");

    expect(result.qualityGate).toBe("NONE");
    expect(result.analyzed).toBe(false);
    expect(result.dashboardUrl).toContain("id=p-alpha");
    expect(result.dashboardUrl).toContain("pullRequest=42");
  });

  it("aggregates quality gate, issue counts, and measures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/qualitygates/project_status")) {
        return ok({ projectStatus: { status: "OK" } });
      }
      if (u.includes("/api/issues/search")) {
        if (u.includes("issueStatuses=ACCEPTED")) return ok({ total: 1 });
        return ok({ total: 3 });
      }
      if (u.includes("/api/measures/component")) {
        return ok({
          component: {
            measures: [
              { metric: "new_coverage", value: "85.3" },
              { metric: "coverage", value: "80" },
              { metric: "new_security_hotspots", value: "2" },
              { metric: "new_duplicated_lines_density", value: "1.5" },
              { metric: "duplicated_lines_density", value: "0.2" },
            ],
          },
        });
      }
      return fail();
    });

    const client = new SonarClient(config, makeDeps(fetchMock));
    const result = await client.fetchProject("alpha", "p-alpha", "42");

    expect(result.qualityGate).toBe("OK");
    expect(result.analyzed).toBe(true);
    expect(result.issues).toEqual({ new: 3, accepted: 1 });
    expect(result.newSecurityHotspots).toBe(2);
    expect(result.newCoverage).toBe(85.3);
    expect(result.coverage).toBe(80);
    expect(result.newDuplications).toBe(1.5);
    expect(result.duplications).toBe(0.2);
  });

  it("prefers period.value over value when present", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/qualitygates/project_status")) {
        return ok({ projectStatus: { status: "OK" } });
      }
      if (u.includes("/api/issues/search")) return ok({ total: 0 });
      return ok({
        component: {
          measures: [{ metric: "new_coverage", value: "10", period: { value: "99.9" } }],
        },
      });
    });

    const client = new SonarClient(config, makeDeps(fetchMock));
    const result = await client.fetchProject("alpha", "p-alpha", "1");
    expect(result.newCoverage).toBe(99.9);
  });

  it("treats issue search failure as null count", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/qualitygates/project_status")) {
        return ok({ projectStatus: { status: "OK" } });
      }
      if (u.includes("/api/issues/search")) return fail();
      return ok({ component: { measures: [] } });
    });

    const client = new SonarClient(config, makeDeps(fetchMock));
    const result = await client.fetchProject("a", "p", "1");
    expect(result.issues).toEqual({ new: null, accepted: null });
  });

  it("waitForCeTask resolves on SUCCESS", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ok({ task: { status: "SUCCESS" } }));
    const client = new SonarClient(config, makeDeps(fetchMock));
    await expect(client.waitForCeTask("t1")).resolves.toBeUndefined();
  });

  it("waitForCeTask rejects on FAILED", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ok({ task: { status: "FAILED" } }));
    const client = new SonarClient(config, makeDeps(fetchMock));
    await expect(client.waitForCeTask("t1")).rejects.toThrow(/FAILED/);
  });

  it("waitForCeTask polls via the injected sleep until SUCCESS", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ok({ task: { status: "PENDING" } }))
      .mockResolvedValueOnce(ok({ task: { status: "SUCCESS" } }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const client = new SonarClient(config, { fetch: fetchMock, sleep });
    await client.waitForCeTask("t1");

    expect(sleep).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
