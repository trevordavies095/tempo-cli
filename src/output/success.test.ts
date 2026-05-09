import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCommandSuccess } from "./success.js";

describe("writeCommandSuccess", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints human line to stdout for human mode", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeCommandSuccess("human", "tempo-cli 1.2.3", {
      ok: true,
      cli: { name: "tempo-cli", version: "1.2.3" },
    });
    expect(log).toHaveBeenCalledWith("tempo-cli 1.2.3");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("prints compact JSON for json mode", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const body = {
      ok: true,
      cli: { name: "tempo-cli", version: "0.0.0" },
    };
    writeCommandSuccess("json", "ignored", body);
    expect(log).toHaveBeenCalledTimes(1);
    const out = log.mock.calls[0][0] as string;
    expect(JSON.parse(out)).toEqual(body);
  });
});
