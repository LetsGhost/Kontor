import { z } from 'zod'

// v2: Kategorie-Icons sind Namen aus dem Icon-Satz statt Emojis.
// v3: Bereiche. Konten und Budgets gehören zu einem Bereich und werden nur dort ausgewertet.
export const SCHEMA_VERSION = 3

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

export const transactionSchema = z
  .object({
    id,
    date: isoDate,
    ...bookingFields,
    recurringId: id.nullable(),
    // Für den späteren CSV-Import (Duplikat-Erkennung)
    importHash: z.string().nullable(),
    createdAt: z.string()
  })
  .refine(transferIsConsistent, transferMessage)

export const recurringSchema = z
  .object({
    id,
    ...bookingFields,
    interval: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
    startDate: isoDate,
    endDate: isoDate.nullable(),
    nextDueDate: isoDate,
    active: z.boolean()
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
