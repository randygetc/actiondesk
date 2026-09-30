import { describe, expect, it } from "vitest";

import { transcriptToText } from "./transcript";

describe("transcriptToText", () => {
  it("keeps speakers and text from WebVTT, dropping timing, notes and markup", () => {
    const vtt = [
      "WEBVTT - standup",
      "",
      "NOTE recorded by the bot",
      "this is not speech",
      "",
      "1",
      "00:00:05.000 --> 00:00:09.000",
      "<v Mark>Okay, <b>blockers</b>?</v>",
      "",
      "00:00:10.000 --> 00:00:12.000 align:start",
      "<v.loud Randy>I'll fix the webhook by Wednesday.</v>",
    ].join("\n");
    expect(transcriptToText(vtt)).toBe(
      "Mark: Okay, blockers?\nRandy: I'll fix the webhook by Wednesday.",
    );
  });

  it("reads SRT with CRLF line endings", () => {
    const srt =
      "1\r\n00:00:01,000 --> 00:00:02,000\r\nJoy: press kit Thursday\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nMark: great\r\n";
    expect(transcriptToText(srt)).toBe("Joy: press kit Thursday\nMark: great");
  });

  it("collapses a line repeated across consecutive cues", () => {
    const vtt =
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nsame\n\n00:00:02.000 --> 00:00:03.000\nsame\n";
    expect(transcriptToText(vtt)).toBe("same");
  });
});
