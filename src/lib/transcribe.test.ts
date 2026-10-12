import { describe, expect, it } from "vitest";
import { LANGUAGES, MODEL_LABELS, describeProgress, formatBytes } from "./transcribe";

describe("formatBytes", () => {
  it("formats model sizes", () => {
    expect(formatBytes(147_951_465)).toBe("148 MB");
    expect(formatBytes(487_601_967)).toBe("488 MB");
    expect(formatBytes(1_624_555_275)).toBe("1.6 GB");
  });
});

describe("describeProgress", () => {
  it("has no bar value before transcription starts", () => {
    expect(describeProgress({ stage: "extracting" })).toEqual({
      label: "Extracting audio…",
      percent: null,
    });
    expect(describeProgress({ stage: "loading_model" }).percent).toBeNull();
  });

  it("shows the transcription percentage", () => {
    expect(describeProgress({ stage: "transcribing", percent: 42 })).toEqual({
      label: "Transcribing… 42%",
      percent: 42,
    });
  });
});

describe("catalog", () => {
  it("offers auto-detect first, then English, then the rest alphabetically", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes.slice(0, 2)).toEqual(["auto", "en"]);
    expect(new Set(codes).size).toBe(codes.length);
    const rest = LANGUAGES.slice(2).map((l) => l.label);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it("labels every model the backend knows", () => {
    expect(Object.keys(MODEL_LABELS)).toEqual(["base", "small", "large-v3-turbo"]);
  });
});
