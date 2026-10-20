// The fixed lists the database CHECKs (db/migrations/007-009) and the forms
// share. Plain data, so client components can use it too.

export const ACCOUNT_TYPES = ['bank', 'wallet', 'cash', 'savings', 'card'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const CATEGORY_KINDS = ['income', 'expense'] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

export const COLOUR_TOKENS = ['oxford', 'space-cadet', 'yinmn', 'jordy', 'lavender'] as const
export type ColourToken = (typeof COLOUR_TOKENS)[number]

export const CATEGORY_ICONS = [
  'basket', 'plate', 'bus', 'car', 'signal', 'home', 'bolt', 'fuel', 'school', 'family', 'worship',
  'bank', 'heart', 'gift', 'briefcase', 'spark', 'coins', 'tv', 'people', 'bag', 'tag',
] as const
export type CategoryIcon = (typeof CATEGORY_ICONS)[number]
