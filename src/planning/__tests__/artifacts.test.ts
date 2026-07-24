import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  isPlanningComplete,
  readApprovedExecutionLaunchHint,
  readApprovedExecutionLaunchHintOutcome,
  readLatestPlanningArtifacts,
  readPlanningArtifacts,
} from "../artifacts.js";

const roots: string[] = [];

async function fixture(): Promise<{ cwd: string; plans: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "owx-planning-artifacts-"));
  const plans = join(cwd, ".owx", "plans");
  await mkdir(plans, { recursive: true });
  roots.push(cwd);
  return { cwd, plans };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("planning artifacts", () => {
  it("selects a PRD with its matching test specification", async () => {
    const { cwd, plans } = await fixture();
    await writeFile(join(plans, "prd-alpha.md"), "# Alpha\n");
    await writeFile(join(plans, "test-spec-alpha.md"), "# Alpha tests\n");
    const artifacts = readPlanningArtifacts(cwd);
    assert.equal(isPlanningComplete(artifacts), true);
    assert.equal(readLatestPlanningArtifacts(cwd).prdPath, join(plans, "prd-alpha.md"));
  });

  it("resolves only retained Ralph launch hints", async () => {
    const { cwd, plans } = await fixture();
    await writeFile(join(plans, "prd-alpha.md"), '# Alpha\n\nLaunch via owx ralph "Execute alpha"\n');
    await writeFile(join(plans, "test-spec-alpha.md"), "# Alpha tests\n");
    const hint = readApprovedExecutionLaunchHint(cwd, "ralph");
    assert.equal(hint?.mode, "ralph");
    assert.equal(hint?.task, "Execute alpha");
    assert.equal(hint?.command, 'owx ralph "Execute alpha"');
  });

  it("fails closed when retained launch hints are ambiguous", async () => {
    const { cwd, plans } = await fixture();
    await writeFile(
      join(plans, "prd-alpha.md"),
      '# Alpha\n\nLaunch via owx ralph "Execute alpha"\nLaunch via $ralph "Execute beta"\n',
    );
    await writeFile(join(plans, "test-spec-alpha.md"), "# Alpha tests\n");
    assert.equal(readApprovedExecutionLaunchHintOutcome(cwd, "ralph").status, "ambiguous");
  });
});
