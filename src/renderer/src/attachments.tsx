import { FileText, Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Button } from './ui'

/**
 * Fotos von Kassenzetteln kommen mit 3–12 MB aus dem Handy. Für einen lesbaren Beleg reichen 1600 Pixel an der
 * langen Seite und JPEG mit mittlerer Qualität: meist 150–400 KB. PDFs bleiben, wie sie sind.
 */
const MAX_SIDE = 1600
const JPEG_QUALITY = 0.72
const MAX_PDF_BYTES = 20 * 1024 * 1024

export interface PreparedAttachment {
  bytes: Uint8Array
  type: 'jpg' | 'png' | 'webp' | 'pdf'
}

const originalType = (file: File): PreparedAttachment['type'] | null =>
  file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : null

async function shrinkImage(file: File): Promise<PreparedAttachment> {
  // createImageBitmap beachtet die EXIF-Drehung, hochkant fotografierte Zettel stehen also richtig.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    // JPEG kennt keine Transparenz: durchsichtige Stellen (Screenshots, PNG) werden weiß statt schwarz.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new Error('Bild konnte nicht umgewandelt werden')

    // War das Original schon klein genug und kleiner als das Ergebnis, bleibt es unverändert.
    const keep = originalType(file)
    if (keep && scale === 1 && file.size <= blob.size) {
      return { bytes: new Uint8Array(await file.arrayBuffer()), type: keep }
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg' }
  } finally {
    bitmap.close()
  }
}

/** Macht aus einer gewählten Datei einen speicherbaren Beleg. Wirft mit verständlicher Meldung. */
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (file.size > MAX_PDF_BYTES) throw new Error(`„${file.name}“ ist größer als 20 MB`)
    return { bytes: new Uint8Array(await file.arrayBuffer()), type: 'pdf' }
  }
  if (!file.type.startsWith('image/')) throw new Error(`„${file.name}“ ist weder Bild noch PDF`)
  try {
    return await shrinkImage(file)
  } catch {
    // Etwa HEIC vom iPhone, das Chromium nicht lesen kann.
    throw new Error(`„${file.name}“ lässt sich nicht als Bild lesen. Bitte als JPEG oder PDF speichern.`)
  }
}

const isImage = (name: string): boolean => !name.endsWith('.pdf')

/** Vorschaubild eines gespeicherten Belegs, über eine blob-URL aus dem Hauptprozess geladen. */
function Thumbnail({ name }: { name: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage(name)) return
    let objectUrl: string | null = null
    let cancelled = false
    window.kontor
      .readAttachment(name)
      .then((bytes) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]))
        setUrl(objectUrl)
      })
      .catch(() => setUrl(null))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [name])

  if (!isImage(name)) return <FileText size={22} strokeWidth={1.5} className="text-muted" />
  return url ? (
    <img src={url} alt="" className="h-full w-full object-cover" />
  ) : (
    <Paperclip size={16} className="text-muted" />
  )
}

/** Belege einer Buchung: Vorschau, Öffnen im Standardprogramm, Hinzufügen per Dialog oder Ziehen und Ablegen. */
export function AttachmentField({ value, onChange }: { value: string[]; onChange: (names: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const add = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    const added: string[] = []
    try {
      for (const file of files) {
        const prepared = await prepareAttachment(file)
        added.push(await window.kontor.addAttachment(prepared.bytes, prepared.type))
      }
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
      onChange([...new Set([...value, ...added])])
    }
  }

  const open = (name: string): void => {
    window.kontor.openAttachment(name).catch((err: Error) => setError(err.message))
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    void add([...e.dataTransfer.files])
  }

  return (
    <div
      className={`space-y-2 rounded-md border border-dashed p-2 ${dragging ? 'border-accent' : 'border-transparent'}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((name, i) => (
            <li key={name} className="group relative">
              <button
                type="button"
                title="Im Standardprogramm öffnen"
                className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-line bg-bg hover:border-muted"
                onClick={() => open(name)}
              >
                <Thumbnail name={name} />
              </button>
              <button
                type="button"
                aria-label={`Beleg ${i + 1} entfernen`}
                className="absolute -top-1.5 -right-1.5 hidden rounded-full border border-line bg-raised p-0.5 text-muted group-hover:block hover:text-text"
                onClick={() => onChange(value.filter((n) => n !== name))}
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button small disabled={busy} onClick={() => inputRef.current?.click()}>
          <Paperclip size={13} /> {busy ? 'Wird verkleinert …' : 'Beleg hinzufügen'}
        </Button>
        <span className="text-xs text-muted">Foto oder PDF, auch per Ziehen und Ablegen</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/*,application/pdf"
        onChange={(e) => {
          void add([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
