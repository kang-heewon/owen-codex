import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSupportedDoctorOptions } from "../index.js";

describe("doctor option routing", () => {
  it("accepts current options and rejects retired or unknown options", () => {
    assert.doesNotThrow(() => assertSupportedDoctorOptions(["--verbose"]));
    assert.throws(
      () => assertSupportedDoctorOptions(["--team"]),
      /unknown doctor option: --team/,
    );
  });
});
