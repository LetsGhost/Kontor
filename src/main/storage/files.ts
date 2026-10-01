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

/** Schreibt erst in eine temp-Datei und benennt dann um, damit nie eine halbe Datei entsteht. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, JSON.stringify(value, null, 2))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
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
