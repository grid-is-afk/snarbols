import { getDatabase } from "./config";
import {
  MeetingBrief,
  MeetingRecord,
  MeetingSignal,
  MeetingSignalKind,
  MeetingTurn,
  MeetingTurnSource,
  MeetingTurnStatus,
} from "@/types/meeting";

/**
 * Meeting persistence.
 *
 * Tables are created from TypeScript rather than through the Rust migration
 * list, because `sql:allow-execute` is already granted and adding a Rust
 * migration would make this feature un-buildable on a machine without cargo.
 *
 * Turns are written as they finalize, so an app crash costs the recap, not the
 * meeting — the recap can be regenerated later from the stored transcript.
 *
 * Text only. Captured audio is never persisted.
 */

let schemaReady: Promise<void> | null = null;

export function ensureMeetingSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = await getDatabase();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS meeting_briefs (
          id TEXT PRIMARY KEY,
          folder_path TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_briefs_cache
          ON meeting_briefs (folder_path, fingerprint)
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS meetings (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          folder_path TEXT,
          brief_id TEXT,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          recap TEXT
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS meeting_turns (
          id TEXT PRIMARY KEY,
          meeting_id TEXT NOT NULL,
          source TEXT NOT NULL,
          captured_at INTEGER NOT NULL,
          text TEXT NOT NULL,
          status TEXT NOT NULL
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_meeting_turns_meeting
          ON meeting_turns (meeting_id, captured_at)
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS meeting_signals (
          id TEXT PRIMARY KEY,
          meeting_id TEXT NOT NULL,
          turn_id TEXT,
          kind TEXT NOT NULL,
          headline TEXT NOT NULL,
          detail TEXT NOT NULL,
          confidence REAL NOT NULL,
          created_at INTEGER NOT NULL,
          dismissed_at INTEGER
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_meeting_signals_meeting
          ON meeting_signals (meeting_id, created_at)
      `);
    })().catch((error) => {
      // Allow a later call to retry rather than caching the failure forever.
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/* ------------------------------------------------------------------ briefs */

interface DbBrief {
  id: string;
  folder_path: string;
  fingerprint: string;
  content: string;
  created_at: number;
}

/** Cache hit only when BOTH the folder and its content fingerprint match. */
export async function getCachedBrief(
  folderPath: string,
  fingerprint: string
): Promise<MeetingBrief | null> {
  await ensureMeetingSchema();
  const db = await getDatabase();

  const rows = await db.select<DbBrief[]>(
    "SELECT * FROM meeting_briefs WHERE folder_path = ? AND fingerprint = ? LIMIT 1",
    [folderPath, fingerprint]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    folderPath: row.folder_path,
    fingerprint: row.fingerprint,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function saveBrief(brief: MeetingBrief): Promise<void> {
  await ensureMeetingSchema();
  const db = await getDatabase();

  // Supersede any stale brief for this folder — only the current fingerprint
  // is ever useful, and keeping old ones grows the table without benefit.
  await db.execute("DELETE FROM meeting_briefs WHERE folder_path = ?", [
    brief.folderPath,
  ]);
  await db.execute(
    "INSERT INTO meeting_briefs (id, folder_path, fingerprint, content, created_at) VALUES (?, ?, ?, ?, ?)",
    [
      brief.id,
      brief.folderPath,
      brief.fingerprint,
      brief.content,
      brief.createdAt,
    ]
  );
}

/* ---------------------------------------------------------------- meetings */

interface DbMeeting {
  id: string;
  title: string;
  folder_path: string | null;
  brief_id: string | null;
  started_at: number;
  ended_at: number | null;
  recap: string | null;
}

function toMeetingRecord(row: DbMeeting): MeetingRecord {
  return {
    id: row.id,
    title: row.title,
    folderPath: row.folder_path,
    briefId: row.brief_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    recap: row.recap,
  };
}

export async function createMeeting(meeting: MeetingRecord): Promise<void> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  await db.execute(
    "INSERT INTO meetings (id, title, folder_path, brief_id, started_at, ended_at, recap) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      meeting.id,
      meeting.title,
      meeting.folderPath,
      meeting.briefId,
      meeting.startedAt,
      meeting.endedAt,
      meeting.recap,
    ]
  );
}

export async function finishMeeting(params: {
  id: string;
  title: string;
  endedAt: number;
  recap: string | null;
}): Promise<void> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  await db.execute(
    "UPDATE meetings SET title = ?, ended_at = ?, recap = ? WHERE id = ?",
    [params.title, params.endedAt, params.recap, params.id]
  );
}

export async function getAllMeetings(): Promise<MeetingRecord[]> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  const rows = await db.select<DbMeeting[]>(
    "SELECT * FROM meetings ORDER BY started_at DESC"
  );
  return rows.map(toMeetingRecord);
}

export async function getMeetingById(
  id: string
): Promise<MeetingRecord | null> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  const rows = await db.select<DbMeeting[]>(
    "SELECT * FROM meetings WHERE id = ? LIMIT 1",
    [id]
  );
  return rows.length > 0 ? toMeetingRecord(rows[0]) : null;
}

export async function deleteMeeting(id: string): Promise<void> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  await db.execute("DELETE FROM meeting_signals WHERE meeting_id = ?", [id]);
  await db.execute("DELETE FROM meeting_turns WHERE meeting_id = ?", [id]);
  await db.execute("DELETE FROM meetings WHERE id = ?", [id]);
}

/* ------------------------------------------------------------------- turns */

interface DbTurn {
  id: string;
  meeting_id: string;
  source: string;
  captured_at: number;
  text: string;
  status: string;
}

/**
 * Insert or update a turn. Called once when the turn is opened and again when
 * its transcription resolves, so an interrupted meeting still has its
 * transcript up to the moment it stopped.
 */
export async function saveTurn(turn: MeetingTurn): Promise<void> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO meeting_turns (id, meeting_id, source, captured_at, text, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, status = excluded.status`,
    [
      turn.id,
      turn.meetingId,
      turn.source,
      turn.capturedAt,
      turn.text,
      turn.status,
    ]
  );
}

export async function getTurnsForMeeting(
  meetingId: string
): Promise<MeetingTurn[]> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  const rows = await db.select<DbTurn[]>(
    "SELECT * FROM meeting_turns WHERE meeting_id = ? ORDER BY captured_at ASC",
    [meetingId]
  );
  return rows.map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    source: row.source as MeetingTurnSource,
    capturedAt: row.captured_at,
    text: row.text,
    status: row.status as MeetingTurnStatus,
  }));
}

/* ----------------------------------------------------------------- signals */

interface DbSignal {
  id: string;
  meeting_id: string;
  turn_id: string | null;
  kind: string;
  headline: string;
  detail: string;
  confidence: number;
  created_at: number;
  dismissed_at: number | null;
}

export async function saveSignal(signal: MeetingSignal): Promise<void> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO meeting_signals (id, meeting_id, turn_id, kind, headline, detail, confidence, created_at, dismissed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
    [
      signal.id,
      signal.meetingId,
      signal.turnId,
      signal.kind,
      signal.headline,
      signal.detail,
      signal.confidence,
      signal.createdAt,
      signal.dismissedAt,
    ]
  );
}

export async function getSignalsForMeeting(
  meetingId: string
): Promise<MeetingSignal[]> {
  await ensureMeetingSchema();
  const db = await getDatabase();
  const rows = await db.select<DbSignal[]>(
    "SELECT * FROM meeting_signals WHERE meeting_id = ? ORDER BY created_at ASC",
    [meetingId]
  );
  return rows.map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    turnId: row.turn_id,
    kind: row.kind as MeetingSignalKind,
    headline: row.headline,
    detail: row.detail,
    confidence: row.confidence,
    createdAt: row.created_at,
    dismissedAt: row.dismissed_at,
  }));
}
