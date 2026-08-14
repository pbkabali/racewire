import type { Timestamp } from 'firebase/firestore'

/**
 * Fillable forms.
 *
 * A document in the library can be flagged as a form. When it is, the public
 * document row gains a "Fill out" button next to Download, and the app renders
 * a native form rather than asking anyone to print, write and scan.
 *
 * Form definitions live in code, not in Firestore. They carry validation rules,
 * conditional logic and layout that a data-driven builder would have to
 * reinvent badly; and a definition that changed under a half-finished draft
 * would leave that draft unopenable. Adding a form type is a code change on
 * purpose.
 */

export type FormTypeId = 'rally-entry'

export type FieldKind = 'text' | 'date' | 'tel' | 'email' | 'number' | 'select'

/** The three parties on an entry. Several sections are a matrix of these. */
export type PartyKey = 'entrant' | 'driver' | 'codriver'

export type Party = { key: PartyKey; label: string }

export type MatrixRow = {
  key: string
  label: string
  kind: FieldKind
  /** Hint text under the label, for every party. */
  help?: string
  /**
   * Hint text for one party only, overriding `help`. Some rows mean different
   * things per column -- the entrant's email is where the confirmation is sent,
   * the crew's are merely copied.
   */
  helpFor?: Partial<Record<PartyKey, string>>
  /**
   * Parties this row does NOT apply to — the greyed cells on the paper form.
   * Rendered as visibly unavailable rather than omitted, so the on-screen form
   * still maps onto the printed one an organiser has in front of them.
   */
  notApplicableTo?: PartyKey[]
  /** Parties for which this is mandatory. Others are optional. */
  requiredFor?: PartyKey[]
  autoComplete?: string
}

export type MatrixSection = {
  kind: 'matrix'
  id: string
  title: string
  description?: string
  parties: Party[]
  rows: MatrixRow[]
}

export type PlainField = {
  key: string
  label: string
  kind: FieldKind
  required?: boolean
  help?: string
  options?: string[]
  autoComplete?: string
}

export type FieldsSection = {
  kind: 'fields'
  id: string
  title: string
  description?: string
  fields: PlainField[]
}

export type DeclarationSection = {
  kind: 'declaration'
  id: string
  title: string
  /** Paragraphs shown above the signatures; the binding text from the PDF. */
  body: string[]
  /** Must be ticked before the form can be submitted. */
  acknowledgement: string
  signatures: { key: PartyKey; label: string }[]
}

export type FormSection = MatrixSection | FieldsSection | DeclarationSection

export type FormDefinition = {
  id: FormTypeId
  /** Shown in the admin picker and on the fill-out screen. */
  label: string
  description: string
  sections: FormSection[]
}

/** A saved-but-unsubmitted, or submitted, filling of a form. */
export type FormEntry = {
  id: string
  formType: FormTypeId
  /** The library document this was filled from. */
  documentId: string

  /** Answers, keyed `sectionId.rowKey.party` for matrices, `sectionId.fieldKey` otherwise. */
  values: Record<string, string>
  /** Storage paths of signature images, keyed by party. */
  signatures: Partial<Record<PartyKey, string>>

  status: 'draft' | 'submitted'
  /** Verified at the gate; also how an organiser identifies the competitor. */
  licenceNumber: string
  /** The phone that passed OTP. Auth uid owns the record. */
  phone: string
  uid: string

  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  submittedAt: Timestamp | null
  /** Storage path of the generated PDF, once submitted. */
  pdfPath: string | null
}

/** An entry on the organiser's list of valid competition licences. */
export type Licence = {
  /** Document id is the licence number, so a duplicate import overwrites. */
  number: string
  holderName: string
  /** Null when the organiser did not record one. */
  expiresOn: Timestamp | null
  active: boolean
  addedAt: Timestamp | null
}
