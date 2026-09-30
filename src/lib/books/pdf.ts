// PDF.js loading, shared by the upload pipeline and the reader (browser only).
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Lazily loads PDF.js (legacy build for older Safari / WebViews) and points it at our self-hosted worker. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
    const pdfjs = module as unknown as PdfJs;
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return pdfjs;
  });
  return pdfjsPromise;
}

const ASSETS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
};

/**
 * Opens a remote PDF by URL. Only the byte ranges needed for the pages being
 * viewed are fetched, so opening a 500 MB PDF does not download 500 MB.
 */
export async function openPdfUrl(url: string): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    url,
    ...ASSETS,
    rangeChunkSize: 512 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    withCredentials: false,
  });
}

/** Opens a local file without reading all of it into memory (slices are read on demand). */
export async function openPdfBlob(blob: Blob): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await loadPdfJs();
  class BlobTransport extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      blob
        .slice(begin, end)
        .arrayBuffer()
        .then((buffer) => this.onDataRange(begin, new Uint8Array(buffer)))
        .catch(() => this.abort());
    }
  }
  return pdfjs.getDocument({
    range: new BlobTransport(blob.size, null),
    ...ASSETS,
    rangeChunkSize: 1024 * 1024,
    disableAutoFetch: true,
    disableStream: true,
  });
}

export interface PdfInspection {
  title: string | null;
  author: string | null;
  pageCount: number;
  cover: Blob | null;
  metadata: Record<string, unknown>;
}

export class BookParseError extends Error {
  constructor(
    public code: "corrupt" | "encrypted" | "empty" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "BookParseError";
  }
}

const clean = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed && !/^untitled$/i.test(trimmed) ? trimmed.slice(0, 300) : null;
};

export async function renderPdfPageToBlob(doc: PDFDocumentProxy, pageNumber: number, targetWidth: number): Promise<Blob | null> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85));
}

/** Validates a PDF and pulls out what the library needs: page count, title/author, a cover image. */
export async function inspectPdf(file: Blob): Promise<PdfInspection> {
  const task = await openPdfBlob(file);
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "PasswordException") {
      throw new BookParseError("encrypted", "This PDF is password-protected. Remove the password and try again.");
    }
    throw new BookParseError("corrupt", "This PDF couldn't be opened. The file may be damaged or incomplete.");
  }
  try {
    if (doc.numPages < 1) throw new BookParseError("empty", "This PDF has no pages.");
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    let cover: Blob | null = null;
    try {
      cover = await renderPdfPageToBlob(doc, 1, 480);
    } catch {
      // A cover is a nicety; a first page that fails to render is not fatal here.
    }
    return {
      title: clean(info.Title),
      author: clean(info.Author),
      pageCount: doc.numPages,
      cover,
      metadata: {
        producer: clean(info.Producer),
        creator: clean(info.Creator),
        pdf_version: clean(info.PDFFormatVersion),
      },
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}
