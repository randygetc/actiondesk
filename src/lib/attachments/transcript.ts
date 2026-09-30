// .vtt and .srt transcripts → plain "Speaker: text" lines for extraction.
// Timestamps, cue numbers, headers and markup are dropped.

const TIMING = /^\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+/;

function cleanCue(line: string): string {
  // WebVTT voice tags <v Name>text</v> become "Name: text".
  const voiced = line.replace(/<v(?:\.[\w.-]+)?\s+([^>]+)>/g, "$1: ");
  // Any other tags (<b>, <i>, <c.x>, timestamps) are markup, not content.
  return voiced
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function transcriptToText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let skipBlock = false;
  for (const line of lines) {
    if (line.trim() === "") {
      skipBlock = false;
      continue;
    }
    if (skipBlock) continue;
    if (/^WEBVTT\b/.test(line)) continue;
    // NOTE, STYLE and REGION blocks carry no speech.
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      skipBlock = true;
      continue;
    }
    if (TIMING.test(line)) continue;
    if (/^\d+$/.test(line.trim())) continue; // SRT cue number
    const text = cleanCue(line);
    if (text && text !== out.at(-1)) out.push(text);
  }
  return out.join("\n");
}
