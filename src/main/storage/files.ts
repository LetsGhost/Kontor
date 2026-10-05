import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'

/** Eine Datendatei ist unlesbar oder passt nicht zum Schema. */
export class StorageError extends Error {
  constructor(
    public readonly file: string,
    message: string
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

// Virenscanner, Indexdienst und OneDrive halten frisch geschriebene Dateien unter Windows kurz offen.
// Das Umbenennen scheitert dann mit einem dieser Codes und klappt einen Moment später.
const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_DELAYS_MS = [20, 50, 100, 200, 400]

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function renameWithRetry(from: string, to: string, rename = renameSync, sleep = sleepSync): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= RENAME_DELAYS_MS.length || !code || !TRANSIENT_CODES.has(code)) throw err
      sleep(RENAME_DELAYS_MS[attempt])
    }
  }
}

/** Schreibt erst in eine temp-Datei und benennt dann um, damit nie eine halbe Datei entsteht. */
export function writeBytesAtomic(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    if (typeof data === 'string') writeSync(fd, data)
    else writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameWithRetry(tmp, file)
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeBytesAtomic(file, JSON.stringify(value, null, 2))
}

/** Liest und validiert eine Datei. Fehlt sie, gilt `fallback`. */
export function readJson<T>(file: string, schema: z.ZodType<T>, fallback: T): T {
  if (!existsSync(file)) return fallback

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new StorageError(basename(file), `Kein gültiges JSON: ${(err as Error).message}`)
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new StorageError(basename(file), z.prettifyError(result.error))
  }
  return result.data
}
