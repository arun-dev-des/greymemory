import { test } from "node:test";
import assert from "node:assert/strict";
import Memory from "../src/index.js";
import { stubEmbedder, emptyExtractor, tmpDir, rmDir } from "./_helpers.mjs";

test("_parseExtraction is fail-open on every malformed input", () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({ extractor: emptyExtractor, embedder: stubEmbedder(), dir });
    const parse = (raw) => memory._parseExtraction(raw);

    // non-strings never throw (the old library crashed on raw.trim())
    assert.deepEqual(parse(null), []);
    assert.deepEqual(parse(undefined), []);
    assert.deepEqual(parse({ key: "k", value: "v" }), []);
    assert.deepEqual(parse(42), []);

    // plain JSON array
    assert.deepEqual(parse('[{"key":"k","value":"v"}]'), [{ key: "k", value: "v" }]);

    // fenced JSON
    assert.deepEqual(parse('```json\n[{"key":"k","value":"v"}]\n```'), [{ key: "k", value: "v" }]);

    // array embedded in prose
    assert.deepEqual(
      parse('Here are the memories:\n[{"key":"k","value":"v"}]\nDone!'),
      [{ key: "k", value: "v" }]
    );

    // a JSON object (not array) → []
    assert.deepEqual(parse('{"key":"k"}'), []);

    // chatty refusal → []
    assert.deepEqual(parse("Nothing to extract from this conversation."), []);
  } finally { rmDir(dir); }
});
