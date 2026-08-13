import type { FormDefinition, Party } from './types'

const PARTIES: Party[] = [
  { key: 'entrant', label: 'Entrant' },
  { key: 'driver', label: 'First driver' },
  { key: 'codriver', label: 'Co-driver' },
]

/** Licence blocks on the paper form have no Entrant column at all. */
const DRIVERS_ONLY: Party[] = [
  { key: 'driver', label: 'First driver' },
  { key: 'codriver', label: 'Co-driver' },
]

/**
 * KCB UMC Rwenzori Region Rally 2026 entry form.
 *
 * Transcribed from the official PDF. `notApplicableTo` marks the cells greyed
 * out on paper, which stay visible but unfillable so the screen still maps onto
 * the printed form an organiser is holding.
 *
 * The Entrant column carries only a name, an address and an email, all of the
 * latter two optional: an entrant is frequently a team or company, so the
 * personal rows -- names, date of birth, telephones, next of kin -- do not
 * apply and are asked of the drivers instead.
 */
export const rallyEntryForm: FormDefinition = {
  id: 'rally-entry',
  label: 'Rally Entry Form',
  description:
    'Competitor entry: entrant, crew, car and the signed declaration. ' +
    'Requires a competition licence on the organiser’s list.',

  sections: [
    {
      kind: 'matrix',
      id: 'identity',
      title: 'Entrant and crew',
      parties: PARTIES,
      rows: [
        {
          key: 'entrantName',
          label: 'Entrant name',
          kind: 'text',
          notApplicableTo: ['driver', 'codriver'],
          requiredFor: ['entrant'],
          autoComplete: 'organization',
        },
        {
          key: 'familyName',
          label: 'Family name',
          kind: 'text',
          notApplicableTo: ['entrant'],
          requiredFor: ['driver'],
          autoComplete: 'family-name',
        },
        {
          key: 'firstName',
          label: 'First name',
          kind: 'text',
          notApplicableTo: ['entrant'],
          requiredFor: ['driver'],
          autoComplete: 'given-name',
        },
        {
          key: 'dateOfBirth',
          label: 'Date of birth',
          kind: 'date',
          notApplicableTo: ['entrant'],
          requiredFor: ['driver'],
        },
        {
          key: 'passportNationality',
          label: 'Passport nationality',
          kind: 'text',
          notApplicableTo: ['entrant'],
          requiredFor: ['driver'],
          autoComplete: 'country-name',
        },
      ],
    },

    {
      kind: 'matrix',
      id: 'contact',
      title: 'Contact details',
      parties: PARTIES,
      rows: [
        // Collected for all three. Optional for the entrant, which may be a
        // company whose correspondence details sit elsewhere; required of the
        // crew, who have to be reachable.
        {
          key: 'address',
          label: 'Physical / postal address',
          kind: 'text',
          help: 'Optional for the entrant',
          requiredFor: ['driver', 'codriver'],
          autoComplete: 'street-address',
        },
        {
          key: 'phoneUganda',
          label: 'Telephone in Uganda',
          kind: 'tel',
          help: 'Reachable during the event',
          notApplicableTo: ['entrant'],
          requiredFor: ['driver'],
          autoComplete: 'tel',
        },
        // Optional for everyone: a competitor with one number should not be
        // made to invent a second.
        {
          key: 'phoneUsual',
          label: 'Telephone (usual)',
          kind: 'tel',
          help: 'Optional',
          notApplicableTo: ['entrant'],
          autoComplete: 'tel',
        },
        {
          key: 'email',
          label: 'Email address',
          kind: 'email',
          help: 'Optional for the entrant',
          requiredFor: ['driver', 'codriver'],
          autoComplete: 'email',
        },
        {
          key: 'nextOfKin',
          label: 'Next of kin',
          kind: 'text',
          help: 'Name and contact number',
          notApplicableTo: ['entrant'],
          requiredFor: ['driver', 'codriver'],
        },
      ],
    },

    {
      kind: 'matrix',
      id: 'drivingLicence',
      title: 'Driving licence',
      parties: DRIVERS_ONLY,
      rows: [
        { key: 'number', label: 'Number', kind: 'text', requiredFor: ['driver'] },
        { key: 'expiry', label: 'Validity / expiry date', kind: 'date', requiredFor: ['driver'] },
        { key: 'country', label: 'Country of issue', kind: 'text', requiredFor: ['driver'] },
      ],
    },

    {
      kind: 'matrix',
      id: 'competitionLicence',
      title: 'Competition licence',
      description:
        'The first driver’s number must match the licence used to start this form.',
      parties: DRIVERS_ONLY,
      rows: [
        { key: 'number', label: 'Number', kind: 'text', requiredFor: ['driver'] },
        { key: 'expiry', label: 'Validity / expiry date', kind: 'date', requiredFor: ['driver'] },
        { key: 'country', label: 'Country of issue', kind: 'text', requiredFor: ['driver'] },
      ],
    },

    {
      kind: 'fields',
      id: 'car',
      title: 'Details of the car',
      fields: [
        { key: 'make', label: 'Make', kind: 'text', required: true },
        { key: 'registrationNo', label: 'Registration no.', kind: 'text', required: true },
        { key: 'model', label: 'Model', kind: 'text', required: true },
        { key: 'engineCapacity', label: 'Engine capacity', kind: 'text' },
        { key: 'yearOfManufacture', label: 'Year of manufacture', kind: 'number' },
        { key: 'bodyNo', label: 'Body no.', kind: 'text' },
        { key: 'groupClass', label: 'Group / class', kind: 'text' },
        { key: 'engineNo', label: 'Engine no.', kind: 'text' },
        { key: 'homologationNo', label: 'Homologation no.', kind: 'text' },
        { key: 'predominantColor', label: 'Predominant colour', kind: 'text' },
        { key: 'countryOfRegistration', label: 'Country of registration', kind: 'text' },
        { key: 'techPassportNo', label: 'Tech. passport no.', kind: 'text' },
      ],
    },

    {
      kind: 'fields',
      id: 'entry',
      title: 'Details of entry',
      description:
        'Entry fee UGX 350,000. The entry is only valid once the fee is paid and ' +
        'the receipt or bank cheque copy reaches the organiser before the closing date.',
      fields: [
        {
          key: 'entryType',
          label: 'Entry type',
          kind: 'select',
          options: ['Private', 'Other'],
          required: true,
        },
        { key: 'entryTypeOther', label: 'If other, specify', kind: 'text' },
      ],
    },

    {
      kind: 'declaration',
      id: 'declaration',
      title: 'Agreement and indemnity',
      body: [
        'I have read and agreed to be bound by the Supplementary Regulations of the KCB UMC Rwenzori Region Rally, 4–5 September 2026, the National Competition Rules issued by the Federation of Motor Sports Clubs of Uganda (FMU), and the Sporting Regulations of the Fédération Internationale de l’Automobile.',
        'Motor sport can be dangerous and may involve injury or death. The following is designed to create a legally binding relationship in return for being allowed to enter and compete.',
        'I confirm the information on this entry form is correct, and that I am physically and mentally fit to take part and competent to do so.',
        'I understand the nature of the event and the risks inherent in the sport, and accept them notwithstanding that they may involve negligence on the part of the organisers, their officials, the landowner, the promoter, sponsors or others connected with the event.',
        'I agree the car I enter is suitable and proper for its purpose and complies with the regulations. I will not take part if I have any doubt about my ability or the safety of the event or venue, and will not participate under the influence of alcohol or drugs.',
        'I indemnify the organiser, promoter, guarantor, sponsors and landowners, and any government, provincial or municipal body and their officials, against legal liability for damage or injury sustained by me or by any other person as described in the full declaration.',
        'I agree to medical examination and to providing blood or urine samples for analysis, and accept a six-month suspension from motorsport under FMU and FIA if analysis reveals alcohol or prohibited drugs, or if I refuse to provide samples.',
      ],
      acknowledgement:
        'I declare that all information on this entry form is correct, and I accept in full the terms and conditions of the above indemnity and of my participation in this event.',
      signatures: [
        { key: 'entrant', label: 'Entrant’s signature' },
        { key: 'driver', label: 'First driver’s signature' },
        { key: 'codriver', label: 'Co-driver’s signature' },
      ],
    },
  ],
}

export const FORM_DEFINITIONS: Record<string, FormDefinition> = {
  [rallyEntryForm.id]: rallyEntryForm,
}

export function getFormDefinition(id: string | null | undefined): FormDefinition | null {
  if (!id) return null
  return FORM_DEFINITIONS[id] ?? null
}
