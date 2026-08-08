import { readDir, readTextFile, readFile, stat } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import {
  MEETING,
  MEETING_IGNORED_DIRS,
  MEETING_SUPPORTED_EXTENSIONS,
} from "@/config/meeting.constants";
import { MeetingContextDoc, MeetingContextScan } from "@/types/meeting";

/**
 * Reads a project folder into text for brief distillation, and fingerprints it
 * so an unchanged folder never costs a second distillation.
 *
 * Read-only throughout. Nothing here writes to the user's folders.
 */

/** Join using whichever separator the base path already uses. */
function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function isSupported(name: string): boolean {
  return (MEETING_SUPPORTED_EXTENSIONS as readonly string[]).includes(
    extensionOf(name)
  );
}

/** Open the OS folder picker. Returns null when the user cancels. */
export async function pickProjectFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose the project folder for this meeting",
  });
  return typeof selected === "string" ? selected : null;
}

interface FoundFile {
  path: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

/**
 * Walk the folder for supported documents, breadth-first, bounded by depth and
 * file count so pointing at a huge directory cannot hang the app.
 */
async function findDocuments(root: string): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  let queue: Array<{ dir: string; rel: string; depth: number }> = [
    { dir: root, rel: "", depth: 0 },
  ];

  while (queue.length > 0 && found.length < MEETING.MAX_DOC_FILES) {
    const next: typeof queue = [];

    for (const { dir, rel, depth } of queue) {
      let entries;
      try {
        entries = await readDir(dir);
      } catch {
        // Unreadable directory (permissions, race with deletion). Skip it
        // rather than failing the whole scan.
        continue;
      }

      for (const entry of entries) {
        if (found.length >= MEETING.MAX_DOC_FILES) break;
        if (!entry.name || entry.name.startsWith(".")) continue;

        const childPath = joinPath(dir, entry.name);
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          if (MEETING_IGNORED_DIRS.has(entry.name)) continue;
          if (depth + 1 > MEETING.MAX_DOC_DEPTH) continue;
          next.push({ dir: childPath, rel: childRel, depth: depth + 1 });
          continue;
        }

        if (!entry.isFile || !isSupported(entry.name)) continue;

        try {
          const info = await stat(childPath);
          found.push({
            path: childPath,
            relPath: childRel,
            size: info.size ?? 0,
            mtimeMs: info.mtime ? new Date(info.mtime).getTime() : 0,
          });
        } catch {
          // Can't stat it, so it can't be fingerprinted reliably. Skip.
        }
      }
    }

    queue = next;
  }

  // Stable order so the fingerprint is deterministic regardless of FS ordering.
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Identity of the folder's readable content. Changing, adding or removing a
 * document changes this; opening the app again does not.
 */
async function fingerprintOf(files: FoundFile[]): Promise<string> {
  const material = files
    .map((f) => `${f.relPath}|${f.size}|${f.mtimeMs}`)
    .join("\n");
  return sha256Hex(material);
}

/**
 * Extract text from a PDF. pdfjs is imported lazily so its considerable weight
 * never lands in the initial bundle — most meetings never open a PDF, and the
 * app was deliberately bundle-split to keep startup light.
 */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push(text);

      if (pages.join("\n").length > MEETING.MAX_DOC_CHARS) break;
    }
  } finally {
    await doc.destroy();
  }

  return pages.join("\n");
}

async function readDocument(file: FoundFile): Promise<string> {
  if (extensionOf(file.relPath) === ".pdf") {
    const bytes = await readFile(file.path);
    return extractPdfText(bytes);
  }
  return readTextFile(file.path);
}

/**
 * Scan a project folder: fingerprint it and read its documents into text.
 *
 * Never throws for an individual bad document — unreadable files land in
 * `skipped` so the UI can say what was ignored instead of silently pretending
 * the context is complete.
 */
export async function scanProjectFolder(
  folderPath: string
): Promise<MeetingContextScan> {
  const files = await findDocuments(folderPath);
  const fingerprint = await fingerprintOf(files);

  const docs: MeetingContextDoc[] = [];
  const skipped: string[] = [];
  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= MEETING.MAX_TOTAL_DOC_CHARS) {
      skipped.push(file.relPath);
      continue;
    }

    let raw: string;
    try {
      raw = await readDocument(file);
    } catch {
      skipped.push(file.relPath);
      continue;
    }

    const text = raw.trim();
    if (!text) {
      skipped.push(file.relPath);
      continue;
    }

    const remaining = MEETING.MAX_TOTAL_DOC_CHARS - totalChars;
    const budget = Math.min(MEETING.MAX_DOC_CHARS, remaining);
    const truncated = text.length > budget;

    docs.push({
      relPath: file.relPath,
      text: truncated ? text.slice(0, budget) : text,
      truncated,
    });
    totalChars += Math.min(text.length, budget);
  }

  return { folderPath, fingerprint, docs, skipped };
}

/** Concatenate scanned documents into the distillation input. */
export function renderDocsForBrief(scan: MeetingContextScan): string {
  return scan.docs
    .map(
      (doc) =>
        `### ${doc.relPath}${doc.truncated ? " (truncated)" : ""}\n${doc.text}`
    )
    .join("\n\n");
}

/** Last path segment, for showing which project is loaded without the full path. */
export function folderDisplayName(folderPath: string): string {
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || folderPath;
}
