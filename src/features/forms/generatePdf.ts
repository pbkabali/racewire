import type { PDFFont, PDFPage } from 'pdf-lib'

import type { FormDefinition, PartyKey } from './types'

/**
 * Render a completed form to a PDF the organiser can file or print.
 *
 * Generated fresh rather than stamped onto the original: the source PDF has no
 * form fields to fill, and positioning text onto its cells by coordinate would
 * break the first time the official layout is revised. Producing a clean
 * document from the same definition that drove the form keeps the two in step
 * by construction.
 */

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48
const LINE = 14

type Cursor = { page: PDFPage; y: number }

export async function generateEntryPdf({
  definition,
  values,
  signatures,
  eventName,
  licenceNumber,
  phone,
  submittedAt,
}: {
  definition: FormDefinition
  values: Record<string, string>
  /** Party -> PNG data URL. */
  signatures: Partial<Record<PartyKey, string>>
  eventName: string
  licenceNumber: string
  phone: string
  submittedAt: Date
}): Promise<Uint8Array> {
  /*
   * pdf-lib is ~180 KB gzipped and only ever needed at the moment somebody
   * submits a form. Imported statically it lands in the entry chunk, which
   * every spectator downloads to read a notice. Loaded here it costs nothing
   * until it is used.
   */
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let cursor: Cursor = { page: pdf.addPage([A4.width, A4.height]), y: A4.height - MARGIN }

  const newPage = () => {
    cursor = { page: pdf.addPage([A4.width, A4.height]), y: A4.height - MARGIN }
  }

  /** Move down, starting a page when the next block would not fit. */
  const advance = (amount: number) => {
    cursor.y -= amount
    if (cursor.y < MARGIN + 60) newPage()
  }

  const write = (
    text: string,
    options: { font?: PDFFont; size?: number; x?: number; colour?: [number, number, number] } = {},
  ) => {
    const size = options.size ?? 9
    cursor.page.drawText(text, {
      x: options.x ?? MARGIN,
      y: cursor.y,
      size,
      font: options.font ?? font,
      color: options.colour ? rgb(...options.colour) : rgb(0.05, 0.05, 0.05),
    })
  }

  // ---- header ----------------------------------------------------------
  write(definition.label, { font: bold, size: 16 })
  advance(20)
  write(eventName, { size: 11, font: bold })
  advance(LINE)
  write(
    `Licence ${licenceNumber} · ${phone} · submitted ${submittedAt.toLocaleString()}`,
    { size: 8, colour: [0.35, 0.35, 0.35] },
  )
  advance(LINE * 1.5)

  // ---- sections --------------------------------------------------------
  for (const section of definition.sections) {
    if (cursor.y < MARGIN + 120) newPage()

    write(section.title.toUpperCase(), { font: bold, size: 10 })
    advance(LINE)

    if (section.kind === 'matrix') {
      const columnWidth = (A4.width - MARGIN * 2 - 130) / section.parties.length

      write('', {})
      for (const [index, party] of section.parties.entries()) {
        write(party.label, {
          font: bold,
          size: 8,
          x: MARGIN + 130 + index * columnWidth,
          colour: [0.35, 0.35, 0.35],
        })
      }
      advance(LINE)

      for (const row of section.rows) {
        if (cursor.y < MARGIN + 40) newPage()

        write(row.label, { size: 8, colour: [0.35, 0.35, 0.35] })
        for (const [index, party] of section.parties.entries()) {
          const notApplicable = row.notApplicableTo?.includes(party.key)
          const value = notApplicable
            ? '—'
            : (values[`${section.id}.${row.key}.${party.key}`] ?? '')
          write(truncate(value, 26), {
            size: 8,
            x: MARGIN + 130 + index * columnWidth,
            colour: notApplicable ? [0.6, 0.6, 0.6] : undefined,
          })
        }
        advance(LINE)
      }
      advance(LINE * 0.5)
      continue
    }

    if (section.kind === 'fields') {
      for (const field of section.fields) {
        if (cursor.y < MARGIN + 40) newPage()
        write(field.label, { size: 8, colour: [0.35, 0.35, 0.35] })
        write(truncate(values[`${section.id}.${field.key}`] ?? '', 60), {
          size: 8,
          x: MARGIN + 180,
        })
        advance(LINE)
      }
      advance(LINE * 0.5)
      continue
    }

    // ---- declaration ---------------------------------------------------
    for (const paragraph of section.body) {
      for (const line of wrap(paragraph, 105)) {
        if (cursor.y < MARGIN + 40) newPage()
        write(line, { size: 7.5, colour: [0.25, 0.25, 0.25] })
        advance(LINE * 0.8)
      }
      advance(LINE * 0.3)
    }

    advance(LINE * 0.5)
    for (const line of wrap(section.acknowledgement, 105)) {
      if (cursor.y < MARGIN + 40) newPage()
      write(line, { size: 8, font: bold })
      advance(LINE * 0.8)
    }
    advance(LINE)

    // Signatures side by side; a new page if they will not fit whole.
    if (cursor.y < MARGIN + 130) newPage()
    const boxWidth = (A4.width - MARGIN * 2) / section.signatures.length
    const baseline = cursor.y - 70

    for (const [index, signature] of section.signatures.entries()) {
      const x = MARGIN + index * boxWidth
      const dataUrl = signatures[signature.key]

      if (dataUrl) {
        try {
          const png = await pdf.embedPng(dataUrl)
          const scale = Math.min((boxWidth - 16) / png.width, 60 / png.height)
          cursor.page.drawImage(png, {
            x,
            y: baseline + 6,
            width: png.width * scale,
            height: png.height * scale,
          })
        } catch {
          // A corrupt data URL must not lose the whole document.
        }
      }

      cursor.page.drawLine({
        start: { x, y: baseline },
        end: { x: x + boxWidth - 16, y: baseline },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
      })
      cursor.page.drawText(signature.label, {
        x,
        y: baseline - 11,
        size: 7,
        font,
        color: rgb(0.35, 0.35, 0.35),
      })
    }
    cursor.y = baseline - 30
  }

  return pdf.save()
}

/** Helvetica has no glyph for some typographic characters pdf-lib will reject. */
function sanitise(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // Anything still outside WinAnsi would throw during draw.
    .replace(/[^\x20-\xFF]/g, '')
}

function truncate(text: string, max: number): string {
  const clean = sanitise(text)
  return clean.length > max ? `${clean.slice(0, max - 1)}…`.replace('…', '...') : clean
}

function wrap(text: string, width: number): string[] {
  const words = sanitise(text).split(/\s+/)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      if (line) lines.push(line.trim())
      line = word
    } else {
      line = `${line} ${word}`
    }
  }
  if (line.trim()) lines.push(line.trim())
  return lines
}
