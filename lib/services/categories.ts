// CATEGORIES and AUTO-CATEGORISATION RULES (/settings).
import 'server-only'

import { http } from '@/lib/db/executor'
import { isCheckError, isReferencedError, isUniqueError } from '@/lib/db/errors'
import * as repo from '@/lib/repos/categories'
import type { CategoryInput, CategoryRow, RuleRow } from '@/lib/repos/categories'
import type { CategoryKind } from '@/lib/repos/common'
import type { UserActor } from './actor'
import { conflict, invalid, notFound } from './errors'

export function listCategories(actor: UserActor, options: { includeArchived?: boolean; kind?: CategoryKind } = {}): Promise<CategoryRow[]> {
  return repo.listCategories(http, actor.user.id, { includeArchived: options.includeArchived ?? false, kind: options.kind })
}

function explain(error: unknown): never {
  if (isUniqueError(error, 'categories_user_kind_name_key')) throw invalid('name_taken', 'You already have a category with that name.', [{ field: 'name', message: 'You already have a category with that name.' }])
  if (isCheckError(error, 'categories_one_level')) throw invalid('one_level', 'Sub-categories go one level deep: choose a top-level parent.', [{ field: 'parentId', message: 'Choose a top-level category as the parent.' }])
  // The parent FK includes kind: an income parent for an expense category has no match.
  if (isReferencedError(error)) throw invalid('bad_parent', 'The parent must be one of your categories of the same kind.', [{ field: 'parentId', message: 'Choose a parent of the same kind.' }])
  throw error
}

export async function createCategory(actor: UserActor, input: CategoryInput): Promise<string> {
  try {
    return await repo.insertCategory(http, actor.user.id, input)
  } catch (error) {
    explain(error)
  }
}

export async function updateCategory(actor: UserActor, id: string, input: Omit<CategoryInput, 'kind'>): Promise<void> {
  if (input.parentId === id) throw invalid('own_parent', 'A category can’t be its own parent.', [{ field: 'parentId', message: 'Choose a different parent.' }])
  try {
    if (!(await repo.updateCategory(http, actor.user.id, id, input))) throw notFound('Category')
  } catch (error) {
    explain(error)
  }
}

export async function setArchived(actor: UserActor, id: string, archived: boolean): Promise<void> {
  if (!(await repo.setCategoryArchived(http, actor.user.id, id, archived))) throw notFound('Category')
}

/** Deletes an UNUSED category; one with transactions, splits, sub-categories or rules is archived instead. */
export async function deleteCategory(actor: UserActor, id: string): Promise<void> {
  try {
    if (!(await repo.deleteCategory(http, actor.user.id, id))) throw notFound('Category')
  } catch (error) {
    if (isReferencedError(error)) throw conflict('category_in_use', 'Transactions, splits, sub-categories or recurring entries use this category, so it can’t be deleted. Archive it instead.', { offerArchive: true })
    throw error
  }
}

export function listRules(actor: UserActor): Promise<RuleRow[]> {
  return repo.listRules(http, actor.user.id)
}

/** "MTN, Airtel | GLO" → "MTN|AIRTEL|GLO": one canonical form, so the unique index can do its job. */
export function normalisePattern(pattern: string): string {
  return pattern.split(/[|,]/).map((w) => w.trim().toUpperCase()).filter(Boolean).join('|')
}

export async function saveRule(actor: UserActor, id: string | null, input: { pattern: string; categoryId: string; position: number }): Promise<void> {
  const pattern = normalisePattern(input.pattern)
  if (pattern.length < 2) throw invalid('pattern_short', 'Enter at least one word to look for.', [{ field: 'pattern', message: 'Enter a word like BOLT.' }])
  try {
    if (id) {
      if (!(await repo.updateRule(http, actor.user.id, id, { ...input, pattern }))) throw notFound('Rule')
    } else {
      await repo.insertRule(http, actor.user.id, { ...input, pattern })
    }
  } catch (error) {
    if (isUniqueError(error, 'categorise_rules_user_pattern_key')) throw invalid('pattern_taken', 'You already have a rule with those words.', [{ field: 'pattern', message: 'You already have a rule with those words.' }])
    if (isReferencedError(error)) throw notFound('Category')
    throw error
  }
}

export async function deleteRule(actor: UserActor, id: string): Promise<void> {
  if (!(await repo.deleteRule(http, actor.user.id, id))) throw notFound('Rule')
}
