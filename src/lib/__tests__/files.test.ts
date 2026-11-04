import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  fileResponseHeaders,
  mimeForName,
  previewKindFor,
  sanitizeFileName,
  uniqueName,
  uniqueZipPath,
} from "@/lib/files";

describe("sanitizeFileName", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFileName("Report 2026.pdf")).toBe("Report 2026.pdf");
    expect(sanitizeFileName("naïve café.txt")).toBe("naïve café.txt");
  });

  it("strips path separators and traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toMatch(/[/\\]|\.\./);
    expect(sanitizeFileName("a/b\\c.txt")).toBe("a_b_c.txt");
    expect(sanitizeFileName("x..y..z")).toBe("x.y.z");
  });

  it("removes control and bidi characters", () => {
    expect(sanitizeFileName("evil\u0000\u001f‮gpj.exe")).toBe("evilgpj.exe");
    expect(sanitizeFileName("line\r\nbreak.txt")).toBe("linebreak.txt");
  });

  it("removes leading dots and trailing dots/spaces", () => {
    expect(sanitizeFileName(".htaccess")).toBe("htaccess");
    expect(sanitizeFileName("...hidden. ")).toBe("hidden");
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeFileName("...", "untitled")).toBe("untitled");
    expect(sanitizeFileName("", "x")).toBe("x");
    expect(sanitizeFileName(42 as unknown as string, "x")).toBe("x");
  });

  it("caps at 255 characters and keeps the extension", () => {
    const out = sanitizeFileName(`${"a".repeat(400)}.txt`);
    expect(out.length).toBeLessThanOrEqual(255);
    expect(out.endsWith(".txt")).toBe(true);
  });
});

describe("uniqueName / uniqueZipPath", () => {
  it("appends a counter on case-insensitive collisions", () => {
    expect(uniqueName("a.txt", ["b.txt"])).toBe("a.txt");
    expect(uniqueName("a.txt", ["A.TXT"])).toBe("a (1).txt");
    expect(uniqueName("a.txt", ["a.txt", "a (1).txt"])).toBe("a (2).txt");
  });

  it("dedupes zip entries within the same directory", () => {
    const used = new Set<string>();
    expect(uniqueZipPath("dir/x.png", used)).toBe("dir/x.png");
    expect(uniqueZipPath("dir/X.png", used)).toBe("dir/X (1).png");
    expect(uniqueZipPath("other/x.png", used)).toBe("other/x.png");
  });
});

describe("file serving headers", () => {
  it("derives the type from the extension only", () => {
    expect(mimeForName("a.png")).toBe("image/png");
    expect(mimeForName("a.svg")).toBe("text/plain; charset=utf-8");
    expect(mimeForName("a.html")).toBe("text/plain; charset=utf-8");
    expect(mimeForName("a.exe")).toBe("application/octet-stream");
  });

  it("serves allowlisted raster images inline when asked", () => {
    const h = fileResponseHeaders({ name: "photo.JPG", inline: true, contentLength: 10 });
    expect(h.get("Content-Disposition")).toMatch(/^inline;/);
    expect(h.get("Content-Type")).toBe("image/jpeg");
    expect(h.get("Content-Length")).toBe("10");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("never serves svg or html inline", () => {
    for (const name of ["x.svg", "x.html", "x.htm", "x.xml", "x"]) {
      const h = fileResponseHeaders({ name, inline: true });
      expect(h.get("Content-Disposition")).toMatch(/^attachment;/);
      expect(h.get("Content-Type")).not.toMatch(/svg|html|xml/);
      expect(h.get("Content-Security-Policy")).toContain("sandbox");
    }
  });

  it("defaults to attachment", () => {
    expect(fileResponseHeaders({ name: "a.png" }).get("Content-Disposition")).toMatch(/^attachment;/);
  });

  it("allows pdf inline without sandbox (browser PDF viewers refuse sandboxed docs)", () => {
    const h = fileResponseHeaders({ name: "doc.pdf", inline: true });
    expect(h.get("Content-Type")).toBe("application/pdf");
    expect(h.get("Content-Disposition")).toMatch(/^inline;/);
    expect(h.get("Content-Security-Policy")).not.toContain("sandbox");
  });

  it("encodes Content-Disposition per RFC 5987 with an ASCII fallback", () => {
    const v = contentDisposition("attachment", 'résumé "final".pdf');
    expect(v).toContain('filename="re_sume_ _final_.pdf"');
    expect(v).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf");
    expect(v).not.toMatch(/[\r\n]/);
    expect(contentDisposition("inline", "a\r\nb.png")).not.toMatch(/[\r\n]/);
  });

  it("classifies previews", () => {
    expect(previewKindFor("a.webp")).toBe("image");
    expect(previewKindFor("a.pdf")).toBe("pdf");
    expect(previewKindFor("a.md")).toBe("text");
    expect(previewKindFor("a.svg")).toBe("text");
    expect(previewKindFor("a.bin")).toBe("none");
  });
});
