import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import type { EntryListRow } from './rows.js'

/** The event's logo, already fetched and in a format a PDF can carry. */
export type EntryListLogo = { bytes: Uint8Array; format: 'png' | 'jpg' }

/* Matches src/features/forms/generatePdf.ts, so the two documents an
 * organiser handles look like they came from the same system. */
const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48
const ROW_HEIGHT = 18
const HEADER_SIZE = 9

/*
 * The logo is boxed rather than placed at a fixed size: organisers upload
 * whatever they have, from a square club badge to a wide sponsor lock-up, and
 * both have to sit on the same letterhead without one of them dominating it.
 * Never scaled above its natural size -- a small logo stretched to fill the
 * box is blurry on a printed page, and slightly small reads better than soft.
 */
const LOGO_BOX = { width: 120, height: 44 }

const COLUMNS = [
  { label: 'First driver', width: 165 },
  { label: 'Co-driver', width: 165 },
  { label: 'Car', width: 169 },
] as const

/**
 * The standard PDF fonts encode WinAnsi, not Unicode, and pdf-lib throws on a
 * character it cannot encode rather than dropping it. One competitor with a
 * name outside Latin-1 would fail the whole list, so accents are folded to
 * their base letter and anything still unencodable becomes '?'. A slightly
 * flattened name on the printed list beats no list at all.
 */
function encodable(text: string): string {
  return [...text.normalize('NFC')]
    .map((character) => {
      if (character.charCodeAt(0) < 256) return character
      const stripped = character.normalize('NFD').replace(/[̀-ͯ]/g, '')
      return stripped.charCodeAt(0) < 256 ? stripped : '?'
    })
    .join('')
}

/** Cut text to fit its column, with an ellipsis so truncation is visible. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  const available = width - 8
  if (font.widthOfTextAtSize(text, size) <= available) return text

  let cut = text
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > available) {
    cut = cut.slice(0, -1)
  }
  return `${cut}...`
}

/**
 * Render the entry list.
 *
 * Deliberately plain: this is a document that gets printed and pinned to a
 * board in daylight, so it is black text on white with rules, not a styled
 * web page. Column headers repeat on every page because page two of an entry
 * list is otherwise three unlabelled columns of names.
 */
export async function renderEntryListPdf({
  rows,
  eventName,
  eventCode,
  generatedAt,
  logo,
}: {
  rows: EntryListRow[]
  eventName: string
  eventCode: string
  generatedAt: Date
  /** Null when the event has none, or when it could not be embedded. */
  logo?: EntryListLogo | null
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  pdf.setTitle(`${eventName} - Entry List`)
  pdf.setCreator('Racewire')

  /*
   * Embedding can throw on a file that is a valid image but not one PDF can
   * carry, so the failure is absorbed here rather than taking the list with
   * it. An entry list without a badge is still an entry list.
   */
  let embedded = null
  if (logo) {
    try {
      embedded =
        logo.format === 'png' ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes)
    } catch {
      embedded = null
    }
  }

  let page: PDFPage = pdf.addPage([A4.width, A4.height])
  let y = 0

  const stamp =
    `${generatedAt.toISOString().slice(0, 10)} ` +
    `${generatedAt.toISOString().slice(11, 16)} UTC`

  const startPage = (first: boolean) => {
    if (!first) page = pdf.addPage([A4.width, A4.height])
    y = A4.height - MARGIN

    if (first) {
      // Page one only. Repeated on every page it would be furniture, not
      // identity, and it would cost a sheet of rows on a long list.
      let textX = MARGIN
      let logoBottom = y

      if (embedded) {
        const scale = Math.min(
          LOGO_BOX.width / embedded.width,
          LOGO_BOX.height / embedded.height,
          1,
        )
        const width = embedded.width * scale
        const height = embedded.height * scale
        // Top-aligned with the cap height of the event name beside it, so the
        // two read as one letterhead rather than as a badge and a heading.
        const top = y + 12
        page.drawImage(embedded, { x: MARGIN, y: top - height, width, height })
        textX = MARGIN + width + 14
        logoBottom = top - height
      }

      page.drawText(encodable(eventName), { x: textX, y, size: 16, font: bold })
      y -= 20
      page.drawText('Entry List', { x: textX, y, size: 12, font: bold })
      y -= 14
      /*
       * The generation time is not decoration. An entry list circulates as a
       * file, and two copies of "Entry List.pdf" with different contents is
       * exactly the confusion that puts the wrong car on a start line.
       */
      page.drawText(
        `${eventCode} - ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} - generated ${stamp}`,
        { x: textX, y, size: 8, font, color: rgb(0.35, 0.35, 0.35) },
      )
      // Clear whichever runs lower, the text or a tall logo, so the column
      // rule never cuts across the badge.
      y = Math.min(y, logoBottom) - 22
    }

    // Column headers, repeated per page.
    let x = MARGIN
    for (const column of COLUMNS) {
      page.drawText(column.label.toUpperCase(), { x, y, size: 8, font: bold })
      x += column.width
    }
    y -= 6
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4.width - MARGIN, y },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2),
    })
    y -= ROW_HEIGHT
  }

  startPage(true)

  if (!rows.length) {
    page.drawText('No entries have been submitted yet.', {
      x: MARGIN,
      y,
      size: HEADER_SIZE,
      font,
      color: rgb(0.35, 0.35, 0.35),
    })
  }

  for (const row of rows) {
    if (y < MARGIN + ROW_HEIGHT) startPage(false)

    let x = MARGIN
    for (const [index, column] of COLUMNS.entries()) {
      const value = encodable([row.driver, row.codriver, row.car][index] ?? '')
      page.drawText(fit(value, font, HEADER_SIZE, column.width), {
        x,
        y,
        size: HEADER_SIZE,
        font,
      })
      x += column.width
    }

    y -= 4
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4.width - MARGIN, y },
      thickness: 0.4,
      color: rgb(0.85, 0.85, 0.85),
    })
    y -= ROW_HEIGHT - 4
  }

  // Page numbers last, once the total is known.
  const pages = pdf.getPages()
  for (const [index, each] of pages.entries()) {
    each.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: A4.width - MARGIN - 70,
      y: MARGIN - 20,
      size: 7,
      font,
      color: rgb(0.45, 0.45, 0.45),
    })
  }

  return pdf.save()
}
