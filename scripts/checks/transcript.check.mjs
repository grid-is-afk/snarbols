// Sanity harness for the transcript ordering rules. Bundled with esbuild and
// run in node, because the app has no test runner installed.
import { TranscriptBuffer, renderTranscriptWindow, wordCount } from "./.bundle/transcript.mjs";

let failures = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL  ${name}\n      expected ${e}\n      actual   ${a}`);
  } else {
    console.log(`ok    ${name}`);
  }
};

// 1. Out-of-order resolution must not scramble the transcript.
{
  const b = new TranscriptBuffer("m1");
  b.open("a", "system", 1000);
  b.open("b", "mic", 1200);
  b.resolve("b", "my answer");    // mic resolves FIRST
  b.resolve("a", "their question"); // system resolves second
  check(
    "orders by capturedAt, not resolution order",
    b.list().map((t) => t.text),
    ["their question", "my answer"]
  );
}

// 2. A pending older turn holds back newer ones within the grace window.
{
  const b = new TranscriptBuffer("m2");
  b.open("a", "system", 1000);
  b.open("b", "mic", 1100);
  b.resolve("b", "answer arrives early");
  check(
    "pending older turn blocks the one behind it",
    b.drainForAnalysis(2000).map((t) => t.id),
    []
  );
}

// 3. Past the grace budget, analysis advances instead of stalling.
{
  const b = new TranscriptBuffer("m3");
  b.open("a", "system", 1000);
  b.open("b", "mic", 1100);
  b.resolve("b", "answer arrives early");
  check(
    "steps over an over-budget pending turn",
    b.drainForAnalysis(1000 + 4001).map((t) => t.id),
    ["b"]
  );
}

// 4. A stepped-over turn is still emitted once it lands — never dropped.
{
  const b = new TranscriptBuffer("m4");
  b.open("a", "system", 1000);
  b.open("b", "mic", 1100);
  b.resolve("b", "early");
  b.drainForAnalysis(1000 + 4001);
  b.resolve("a", "late arrival");
  check(
    "late arrival is still delivered to analysis",
    b.drainForAnalysis(9000).map((t) => t.text),
    ["late arrival"]
  );
}

// 5. Nothing is ever emitted twice.
{
  const b = new TranscriptBuffer("m5");
  b.open("a", "mic", 1000);
  b.resolve("a", "hello there");
  b.drainForAnalysis(1001);
  check("no double emission", b.drainForAnalysis(9000), []);
}

// 6. Failed turns are consumed without reaching analysis.
{
  const b = new TranscriptBuffer("m6");
  b.open("a", "system", 1000);
  b.fail("a");
  b.open("b", "mic", 1100);
  b.resolve("b", "still fine here");
  check(
    "failed turns never reach analysis",
    b.drainForAnalysis(1200).map((t) => t.id),
    ["b"]
  );
}

// 7. Empty transcription counts as failure, not as an empty final turn.
{
  const b = new TranscriptBuffer("m7");
  b.open("a", "mic", 1000);
  b.resolve("a", "   ");
  check("whitespace transcription is a failure", b.list()[0].status, "failed");
}

// 8. The rolling window trims from the front, keeping the newest exchange.
{
  const turns = [
    { source: "system", text: "aaaa" },
    { source: "mic", text: "bbbb" },
    { source: "system", text: "cccc" },
  ];
  check(
    "window keeps the most recent turns",
    renderTranscriptWindow(turns, 2, 1000),
    "You: bbbb\nSpeaker: cccc"
  );
}

// 9. Character budget also trims from the front.
{
  const turns = [
    { source: "system", text: "a".repeat(50) },
    { source: "mic", text: "short" },
  ];
  check(
    "char budget drops the oldest line",
    renderTranscriptWindow(turns, 10, 20),
    "You: short"
  );
}

// 10. Word floor.
check("word count ignores extra whitespace", wordCount("  one   two  "), 2);
check("word count of empty string", wordCount("   "), 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
