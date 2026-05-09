import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCommandError } from "./error.js";

describe("writeCommandError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints plain message to stderr for human mode", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeCommandError("human", {
      code: "MISSING_API_KEY",
      message: "something went wrong",
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("something went wrong\n");
  });

  it("prints one line of PRD-shaped JSON for json mode", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeCommandError("json", {
      code: "CONFIG_INVALID",
      message: "Invalid TOML in config file /path.",
    });
    expect(write).toHaveBeenCalledTimes(1);
    const line = (write.mock.calls[0][0] as string).replace(/\n$/, "");
    expect(JSON.parse(line)).toEqual({
      error: {
        code: "CONFIG_INVALID",
        message: "Invalid TOML in config file /path.",
        request_id: null,
      },
    });
  });

  it("includes request_id when provided", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeCommandError("json", {
      code: "UNAUTHORIZED",
      message: "nope",
      request_id: "req-1",
    });
    const line = (write.mock.calls[0][0] as string).replace(/\n$/, "");
    expect(JSON.parse(line)).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "nope",
        request_id: "req-1",
      },
    });
  });
});
