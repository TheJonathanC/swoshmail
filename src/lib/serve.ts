/** Streams stored objects to the client with safe headers. */
import { NextResponse } from "next/server";
import { getObjectText, getObjectWebStream } from "@/lib/r2";
import { fileResponseHeaders, getExtension } from "@/lib/files";
import { MAX_TEXT_PREVIEW_BYTES, TEXT_PREVIEW_EXTENSIONS } from "@/lib/constants";
import type { TextPreviewResponse } from "@/types/api";

export async function streamFile(file: { key: string; name: string; size: number | string }, inline: boolean): Promise<Response> {
  const { stream, contentLength } = await getObjectWebStream(file.key);
  const headers = fileResponseHeaders({
    name: file.name,
    inline,
    contentLength: contentLength ?? Number(file.size),
  });
  return new Response(stream, { status: 200, headers });
}

/** JSON text preview for text-like extensions (<= 256 KB), never rendered as HTML. */
export async function textPreview(file: { key: string; name: string; size: number | string }): Promise<Response> {
  const ext = getExtension(file.name);
  const size = Number(file.size) || 0;
  let body: TextPreviewResponse;
  if (!TEXT_PREVIEW_EXTENSIONS.has(ext)) {
    body = { content: "Preview is not available for this file type. Download it to view.", truncated: false };
  } else if (size > MAX_TEXT_PREVIEW_BYTES) {
    body = {
      content: `This file is ${(size / 1024).toFixed(1)} KB, which is too large to preview. Download it to view.`,
      truncated: true,
    };
  } else {
    body = { content: await getObjectText(file.key), truncated: false };
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
