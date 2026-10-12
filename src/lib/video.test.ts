import { describe, expect, it } from "vitest";
import { fileName, formatDuration, formatFps } from "./video";

describe("formatDuration", () => {
  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0:00.000");
  });

  it("formats minutes, seconds and milliseconds", () => {
    expect(formatDuration(83_456)).toBe("1:23.456");
    expect(formatDuration(5_007)).toBe("0:05.007");
  });

  it("adds hours from one hour up", () => {
    expect(formatDuration(3_599_999)).toBe("59:59.999");
    expect(formatDuration(3_600_000)).toBe("1:00:00.000");
    expect(formatDuration(3_723_000)).toBe("1:02:03.000");
  });
});

describe("formatFps", () => {
  it("rounds to two decimals", () => {
    expect(formatFps(30000 / 1001)).toBe("29.97");
    expect(formatFps(25)).toBe("25");
  });
});

describe("fileName", () => {
  it("handles macOS and Windows paths", () => {
    expect(fileName("/Users/me/Movies/clip.mp4")).toBe("clip.mp4");
    expect(fileName("C:\\Videos\\clip.mov")).toBe("clip.mov");
  });
});
