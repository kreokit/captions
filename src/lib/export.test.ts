import { describe, expect, it } from "vitest";
import { defaultExportName } from "./export";

describe("defaultExportName", () => {
  it("swaps the video's extension", () => {
    expect(defaultExportName("/Users/me/Movies/clip.final.mov", "srt")).toBe("clip.final.srt");
    expect(defaultExportName("C:\\Videos\\talk.mp4", "vtt")).toBe("talk.vtt");
    expect(defaultExportName("/tmp/noext", "srt")).toBe("noext.srt");
  });
});
