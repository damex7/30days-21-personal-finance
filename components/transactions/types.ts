// What the transaction forms need to know about accounts and categories:
// plain data passed from Server Components to the client forms.

export type AccountOption = { id: string; name: string; type: string; balanceKobo: number }
export type CategoryOption = { id: string; name: string; kind: 'income' | 'expense'; parentName: string | null }
