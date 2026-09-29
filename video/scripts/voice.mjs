// Render the narration with ElevenLabs in one continuous take, so the voice stays the same.
// Each blank-line paragraph in the script is one scene. [tags] direct the delivery and are not spoken.
// Usage: node scripts/voice.mjs <voice_id> [model_id]
// Writes assets/voice/narration.mp3 and assets/voice/timings.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const voiceId = process.argv[2];
const model = process.argv[3] || "eleven_v4";
if (!voiceId) throw new Error("Usage: node scripts/voice.mjs <voice_id> [model_id]");

const script = readFileSync("../docs/1PASSWORD-NARRATION.txt", "utf8").trim();
const paragraphs = script.split(/\n\s*\n/).map((p) => p.trim().replace(/\s*\n\s*/g, " "));

// Say the brand as "Wallet-term". The words are mapped back to "Walleterm" below.
const spoken = paragraphs.join("\n\n").replace(/Walleterm/g, "Wallet-term").replace(/walleterm/g, "wallet-term");

const raw = execFileSync(
  "elevenlabs",
  [
    "text-to-speech",
    "convert_with_timestamps",
    "--params",
    JSON.stringify({ voice_id: voiceId, output_format: "mp3_44100_128" }),
    "--json",
    JSON.stringify({ text: spoken, model_id: model }),
  ],
  { maxBuffer: 256 * 1024 * 1024 },
).toString();
const res = JSON.parse(raw);

const out = "assets/voice";
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/narration.mp3`, Buffer.from(res.audio_base64, "base64"));
const seconds = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${out}/narration.mp3`]).toString(),
);

// Group the aligned characters into spoken words. Characters inside [tags] are skipped.
const a = res.alignment;
const words = [];
let cur = null;
let depth = 0;
a.characters.forEach((ch, k) => {
  if (ch === "[") depth++;
  const skip = depth > 0;
  if (ch === "]") depth = Math.max(0, depth - 1);
  if (skip || /\s/.test(ch)) {
    cur = null;
    return;
  }
  const s = a.character_start_times_seconds[k];
  const e = a.character_end_times_seconds[k];
  if (!cur) {
    cur = { w: "", start: s, end: e };
    words.push(cur);
  }
  cur.w += ch;
  cur.end = e;
});
for (const w of words) w.w = w.w.replace(/wallet-term/gi, "Walleterm");

// Split the words into scenes by the word count of each paragraph.
const count = (p) => p.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;
let i = 0;
const scenes = paragraphs.map((p, k) => {
  const n = count(p);
  const ws = words.slice(i, i + n);
  i += n;
  return { n: k + 1, text: p, words: ws };
});
if (i !== words.length) throw new Error(`Word count mismatch: script ${i}, aligned ${words.length}`);

writeFileSync(`${out}/timings.json`, JSON.stringify({ voice_id: voiceId, model, seconds, scenes }, null, 2));
console.log(`${model} ${voiceId}: ${seconds.toFixed(1)} s, ${words.length} words, ${scenes.length} scenes`);
for (const s of scenes) console.log(s.n, s.words[0].start.toFixed(2), "->", s.words.at(-1).end.toFixed(2));
