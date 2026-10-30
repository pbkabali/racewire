/**
 * The spreadsheet id, from whatever was pasted.
 *
 * The id is the long segment in a Sheets URL, and asking somebody to pick it
 * out by hand is asking for the trailing `/edit#gid=0` to come with it — or
 * for the whole URL to be pasted, which is the reasonable thing to do with a
 * field labelled "spreadsheet". Both work now.
 *
 * A bare id passes through untouched, so nothing is lost by pasting it
 * correctly in the first place.
 */
export function extractSheetId(input: string): string {
  const value = input.trim()
  if (!value) return ''

  /*
   * https://docs.google.com/spreadsheets/d/<id>/edit#gid=0
   * https://docs.google.com/spreadsheets/u/0/d/<id>/edit
   *
   * The /u/0/ segment is not an edge case: Google puts it there for anybody
   * signed in to more than one account, which is most people with a work and
   * a personal address.
   */
  const fromUrl = value.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/)
  if (fromUrl?.[1]) return fromUrl[1]

  /*
   * Anything else with a slash in it is a URL this does not recognise -- a
   * shortened link, a Drive file link, someone's /u/0/ variant. Returning it
   * unchanged would store a URL in a field the API will send verbatim and
   * fail on; returning nothing lets the form say so instead.
   */
  if (value.includes('/')) return ''

  return value
}
