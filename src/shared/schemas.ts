import { z } from 'zod'

// v2: Kategorie-Icons sind Namen aus dem Icon-Satz statt Emojis.
// v3: Bereiche. Konten und Budgets gehören zu einem Bereich und werden nur dort ausgewertet.
// v4: Aufgeteilte Buchungen, Belege an Buchungen und Vertragsdaten an wiederkehrenden Posten.
export const SCHEMA_VERSION = 4

export const DEFAULT_AREA = { id: 'area-privat', name: 'Privat' }

const id = z.string().min(1)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss JJJJ-MM-TT sein')
// Beträge sind immer ganze Cent, nie Kommazahlen.
const cents = z.number().int()

export const metaSchema = z.object({
  schemaVersion: z.number().int().positive(),
  createdAt: z.string()
})

/** Ein Bereich fasst Konten zusammen, die gemeinsam ausgewertet werden, z. B. „Privat“ und „Haushalt“. */
export const areaSchema = z.object({
  id,
  name: z.string().min(1)
})

export const accountSchema = z.object({
  id,
  areaId: id,
  name: z.string().min(1),
  type: z.enum(['giro', 'savings']),
  openingBalanceCents: cents,
  openingDate: isoDate,
  archived: z.boolean()
})

export const categorySchema = z.object({
  id,
  name: z.string().min(1),
  // null = Hauptkategorie, sonst id der Hauptkategorie (maximal zwei Ebenen)
  parentId: id.nullable(),
  kind: z.enum(['expense', 'income']),
  color: z.string(),
  icon: z.string(),
  archived: z.boolean()
})

export const transactionTypeSchema = z.enum(['expense', 'income', 'transfer'])

// amountCents ist immer positiv, die Richtung ergibt sich aus type.
// Bei einer Umbuchung ist accountId das Quell- und transferAccountId das Zielkonto. Eine Umbuchung in
// einen anderen Bereich darf eine Ausgaben-Kategorie tragen: Für den Quellbereich ist sie eine Ausgabe.
const bookingFields = {
  accountId: id,
  type: transactionTypeSchema,
  amountCents: cents.positive(),
  payee: z.string(),
  note: z.string(),
  categoryId: id.nullable(),
  transferAccountId: id.nullable()
}

const transferIsConsistent = (b: {
  type: string
  accountId: string
  transferAccountId: string | null
}): boolean =>
  b.type === 'transfer'
    ? b.transferAccountId !== null && b.transferAccountId !== b.accountId
    : b.transferAccountId === null

const transferMessage = 'Umbuchung braucht ein anderes Zielkonto, andere Buchungen keines'

/** Ein Teil einer aufgeteilten Buchung, etwa der Drogerie-Anteil eines Supermarkt-Einkaufs. */
export const splitSchema = z.object({
  categoryId: id.nullable(),
  amountCents: cents.positive(),
  note: z.string()
})

/** Belege liegen unter data/attachments/. Der Name ist ein Hash des Inhalts plus Dateiendung. */
export const ATTACHMENT_NAME = /^[a-f0-9]{16,64}\.(jpg|png|webp|pdf)$/
export const attachmentNameSchema = z.string().regex(ATTACHMENT_NAME, 'Ungültiger Belegname')

// Eine aufgeteilte Buchung trägt ihre Kategorien nur in den Teilen. Die Teile ergeben zusammen den Betrag.
const splitsAreConsistent = (b: {
  type: string
  amountCents: number
  categoryId: string | null
  splits: { amountCents: number }[]
}): boolean =>
  b.splits.length === 0 ||
  (b.type !== 'transfer' &&
    b.splits.length >= 2 &&
    b.categoryId === null &&
    b.splits.reduce((sum, s) => sum + s.amountCents, 0) === b.amountCents)

const splitMessage = 'Eine Aufteilung braucht mindestens zwei Teile, die zusammen den Betrag ergeben'

export const transactionSchema = z
  .object({
    id,
    date: isoDate,
    ...bookingFields,
    recurringId: id.nullable(),
    // Für den CSV-Import (Duplikat-Erkennung)
    importHash: z.string().nullable(),
    createdAt: z.string(),
    splits: z.array(splitSchema),
    attachments: z.array(attachmentNameSchema)
  })
  .refine(transferIsConsistent, transferMessage)
  .refine(splitsAreConsistent, splitMessage)

/**
 * Vertragsdaten zu einem wiederkehrenden Posten. Nach `endDate` verlängert sich der Vertrag um
 * `renewalMonths` (0 = er endet). Gekündigt werden muss `notice` vor dem jeweiligen Laufzeitende.
 */
export const contractSchema = z.object({
  endDate: isoDate,
  renewalMonths: z.number().int().min(0),
  noticeAmount: z.number().int().min(0),
  noticeUnit: z.enum(['days', 'weeks', 'months'])
})

export const recurringSchema = z
  .object({
    id,
    ...bookingFields,
    interval: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
    startDate: isoDate,
    endDate: isoDate.nullable(),
    nextDueDate: isoDate,
    active: z.boolean(),
    contract: contractSchema.nullable()
  })
  .refine(transferIsConsistent, transferMessage)

export const budgetSchema = z.object({
  areaId: id,
  categoryId: id,
  limitCents: cents.positive()
})

export const collectionSchemas = {
  areas: z.array(areaSchema),
  accounts: z.array(accountSchema),
  categories: z.array(categorySchema),
  recurring: z.array(recurringSchema),
  budgets: z.array(budgetSchema),
  // Erkannte Muster, die nicht als wiederkehrend angelegt werden sollen (Schlüssel aus patternKey)
  dismissedPatterns: z.array(z.string())
}
export const transactionsSchema = z.array(transactionSchema)

export type Meta = z.infer<typeof metaSchema>
export type Area = z.infer<typeof areaSchema>
export type Account = z.infer<typeof accountSchema>
export type Category = z.infer<typeof categorySchema>
export type Transaction = z.infer<typeof transactionSchema>
export type TransactionType = z.infer<typeof transactionTypeSchema>
export type Recurring = z.infer<typeof recurringSchema>
export type Budget = z.infer<typeof budgetSchema>
export type Split = z.infer<typeof splitSchema>
export type Contract = z.infer<typeof contractSchema>

export type CollectionName = keyof typeof collectionSchemas

export interface KontorData {
  areas: Area[]
  accounts: Account[]
  categories: Category[]
  recurring: Recurring[]
  budgets: Budget[]
  dismissedPatterns: string[]
  transactions: Transaction[]
}
