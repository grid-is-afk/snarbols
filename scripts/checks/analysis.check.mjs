import { parseSignals, signalDedupeKey } from "./.bundle/analysis.mjs";

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

// The critical distinction: null means BROKEN, [] means "nothing to flag".
// Conflating them would either spam a false "analysis paused" warning or hide
// a genuinely dead analysis behind an innocent-looking empty panel.
check("valid empty result is [] not null", parseSignals('{"signals":[]}'), []);
check("unparseable garbage is null", parseSignals("not json at all"), null);
check("empty string is null", parseSignals(""), null);
check("missing signals key is null", parseSignals('{"other":1}'), null);
check("signals not an array is null", parseSignals('{"signals":"nope"}'), null);

// Fence stripping — the model may wrap JSON despite instructions.
check(
  "strips ```json fences",
  parseSignals('```json\n{"signals":[]}\n```'),
  []
);
check("strips bare fences", parseSignals("```\n{\"signals\":[]}\n```"), []);
check(
  "tolerates leading commentary",
  parseSignals('Sure! Here you go:\n{"signals":[]}'),
  []
);

// Confidence floor is 0.5.
{
  const low = parseSignals(
    '{"signals":[{"kind":"scope","headline":"x","detail":"y","confidence":0.2}]}'
  );
  check("low confidence discarded", low, []);
}
{
  const ok = parseSignals(
    '{"signals":[{"kind":"scope","headline":"SSO not in scope","detail":"deferred to phase 2","confidence":0.9}]}'
  );
  check("valid signal survives", ok.length, 1);
  check("kind preserved", ok[0].kind, "scope");
}

// Unknown kinds and malformed entries are dropped, not crashed on.
check(
  "unknown kind dropped",
  parseSignals(
    '{"signals":[{"kind":"vibes","headline":"x","detail":"y","confidence":0.9}]}'
  ),
  []
);
check(
  "missing headline dropped",
  parseSignals('{"signals":[{"kind":"scope","confidence":0.9}]}'),
  []
);
check(
  "null entry dropped",
  parseSignals('{"signals":[null,{"kind":"scope","headline":"a","detail":"b","confidence":0.8}]}')
    .length,
  1
);
check(
  "non-numeric confidence treated as 0 and dropped",
  parseSignals(
    '{"signals":[{"kind":"scope","headline":"x","detail":"y","confidence":"high"}]}'
  ),
  []
);

// Headline clamped to 12 words so it stays glanceable mid-conversation.
{
  const long = parseSignals(
    JSON.stringify({
      signals: [
        {
          kind: "suggestion",
          headline: Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "),
          detail: "d",
          confidence: 0.9,
        },
      ],
    })
  );
  check("headline clamped to 12 words", long[0].headline.split(" ").length, 12);
}

// A misbehaving model cannot flood the panel.
{
  const many = parseSignals(
    JSON.stringify({
      signals: Array.from({ length: 10 }, (_, i) => ({
        kind: "question",
        headline: `headline number ${i}`,
        detail: "d",
        confidence: 0.9,
      })),
    })
  );
  check("output capped at 2 signals", many.length, 2);
}

// Dedupe key normalises punctuation and case.
check(
  "dedupe key ignores case and punctuation",
  signalDedupeKey("scope", "SSO not in scope!") ===
    signalDedupeKey("scope", "sso  not in  scope"),
  true
);
check(
  "dedupe key separates kinds",
  signalDedupeKey("scope", "same") === signalDedupeKey("question", "same"),
  false
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
