import { describe, expect, it } from "vitest";
import { splitFences } from "./markdown";

describe("splitFences", () => {
  it("splits prose and fenced code blocks in order, keeping the language and the code as written", () => {
    const md = "1. Run:\n\n```sh\nkubectl get pods\nkubectl rollout restart deploy/x\n```\n\n2. Then merge #12.";
    expect(splitFences(md)).toEqual([
      { kind: "text", text: "1. Run:" },
      { kind: "code", text: "kubectl get pods\nkubectl rollout restart deploy/x", lang: "sh" },
      { kind: "text", text: "2. Then merge #12." },
    ]);
  });
  it("handles several blocks, ~~~ fences, no language, and indented fences", () => {
    const segs = splitFences("a\n```\none\n```\nb\n~~~bash\ntwo\n~~~\n  ```\n  three\n  ```");
    expect(segs.map((s) => s.kind)).toEqual(["text", "code", "text", "code", "code"]);
    expect(segs[1]).toMatchObject({ text: "one", lang: null });
    expect(segs[3]).toMatchObject({ text: "two", lang: "bash" });
    expect(segs[4].text).toBe("  three");
  });
  it("a longer fence is not closed by a shorter one, and an unclosed fence runs to the end", () => {
    expect(splitFences("````\n```\ninner\n```\n````")).toEqual([{ kind: "code", text: "```\ninner\n```", lang: null }]);
    expect(splitFences("text\n```sh\nnever closed\nstill code")).toEqual([
      { kind: "text", text: "text" },
      { kind: "code", text: "never closed\nstill code", lang: "sh" },
    ]);
  });
  it("is plain prose without fences, and empty for nothing", () => {
    expect(splitFences("just **markdown**\n\nwith paragraphs")).toEqual([{ kind: "text", text: "just **markdown**\n\nwith paragraphs" }]);
    expect(splitFences("")).toEqual([]);
    expect(splitFences("  \n\n")).toEqual([]);
  });
  it("accepts Windows line endings", () => {
    expect(splitFences("x\r\n```\r\ny\r\n```\r\n")).toEqual([{ kind: "text", text: "x" }, { kind: "code", text: "y", lang: null }]);
  });
});
