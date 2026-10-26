import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// The Python build removes artifacts produced before the distribution was
// renamed. These exact legacy cleanup patterns are data, not public identities.
const legacyDistributionName = ["stagehand", "v4"].join("_");
const allowedLegacyCleanupMatches = new Set([
  `packages/sdk-python/scripts/build.py:"${legacyDistributionName}-*.whl",`,
  `packages/sdk-python/scripts/build.py:"${legacyDistributionName}-*.tar.gz",`,
  `packages/sdk-python/tests/test_build.py:"${legacyDistributionName}-0.1.0-py3-none-any.whl",`,
  `packages/sdk-python/tests/test_build.py:"${legacyDistributionName}-0.1.0.tar.gz",`,
]);

function findUnexpectedIdentities(stdout: string): string[] {
  return stdout
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((match) => {
      const parsed = /^(?<file>[^:]+):\d+:(?<contents>.*)$/u.exec(match)?.groups;
      if (!parsed?.file || parsed.contents === undefined) return [match];
      const identity = `${parsed.file}:${parsed.contents.trim()}`;
      return allowedLegacyCleanupMatches.has(identity) ? [] : [match];
    });
}

describe("Retired package identities", () => {
  const allowedMatches = [...allowedLegacyCleanupMatches].map((match) =>
    match.replace(":", ":1:        "),
  );

  it.each([
    ["LF", allowedMatches.join("\n") + "\n"],
    ["CRLF", allowedMatches.join("\r\n") + "\r\n"],
    ["mixed line endings", allowedMatches[0] + "\r\n" + allowedMatches.slice(1).join("\n")],
  ])("allows legacy cleanup matches with %s", (_name, stdout) => {
    expect(findUnexpectedIdentities(stdout)).toEqual([]);
  });

  it("allows empty output", () => {
    expect(findUnexpectedIdentities("")).toEqual([]);
  });

  it.each(["\n", "\r\n"])("rejects forbidden matches with %j", (separator) => {
    const forbiddenMatch = `packages/example.ts:1:${legacyDistributionName}`;
    const stdout = [...allowedMatches, forbiddenMatch, ...allowedMatches].join(separator);

    expect(findUnexpectedIdentities(stdout)).toEqual([forbiddenMatch]);
  });

  it("does not reintroduce a Stagehand v4 package or test identity", async () => {
    const pattern = ["stagehand", "[-_]v4"].join("");
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync("git", ["grep", "-n", "-I", "-E", pattern, "--", "."], {
        encoding: "utf8",
      }));
    } catch (error) {
      const grepError = error as Error & { code?: number; stdout?: string };
      if (grepError.code !== 1) throw error;
      stdout = grepError.stdout ?? "";
    }
    const unexpected = findUnexpectedIdentities(stdout);

    expect(
      unexpected,
      "Use the stable Stagehand package identity; only exact Python legacy-artifact cleanup patterns are allowed",
    ).toEqual([]);
  });
});
