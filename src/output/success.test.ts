import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCommandSuccess } from "./success.js";

describe("writeCommandSuccess", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints human line to stdout for human mode", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeCommandSuccess("human", "tempo-cli 1.2.3", {
      ok: true,
      cli: { name: "tempo-cli", version: "1.2.3" },
    });
    expect(write).toHaveBeenCalledWith("tempo-cli 1.2.3\n");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("prints compact JSON for json mode", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const body = {
      ok: true,
      cli: { name: "tempo-cli", version: "0.0.0" },
    };
    writeCommandSuccess("json", "ignored", body);
    expect(write).toHaveBeenCalledTimes(1);
    const out = write.mock.calls[0][0] as string;
    expect(JSON.parse(out)).toEqual(body);
  });
});
