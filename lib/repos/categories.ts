// CATEGORIES and AUTO-CATEGORISATION RULES: SQL only, always WHERE user_id.
import 'server-only'

import { z } from 'zod'
import { one, rows, type Db } from '@/lib/db/executor'
import { empty, q } from '@/lib/db/sql'
import { CATEGORY_ICONS, CATEGORY_KINDS, COLOUR_TOKENS, type CategoryIcon, type CategoryKind, type ColourToken } from './common'

export const CategoryRow = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(CATEGORY_KINDS),
  parentId: z.uuid().nullable(),
  parentName: z.string().nullable(),
  colour: z.enum(COLOUR_TOKENS),
  icon: z.enum(CATEGORY_ICONS),
  archivedAt: z.date().nullable(),
  /** How many live transactions (or split lines) use it: decides delete vs archive. */
  useCount: z.number().int(),
})
export type CategoryRow = z.infer<typeof CategoryRow>

const columns = q`c.id, c.name, c.kind, c.parent_id AS "parentId", p.name AS "parentName", c.colour, c.icon,
  c.archived_at AS "archivedAt",
  ((SELECT count(*) FROM transactions t WHERE t.user_id = c.user_id AND t.category_id = c.id AND t.deleted_at IS NULL)
   + (SELECT count(*) FROM transaction_splits s WHERE s.user_id = c.user_id AND s.category_id = c.id))::int AS "useCount"`

/** Parents first, each followed by its children, alphabetically. */
export function listCategories(db: Db, userId: string, options: { includeArchived: boolean; kind?: CategoryKind }): Promise<CategoryRow[]> {
  return rows(
    db,
    CategoryRow,
    q`SELECT ${columns}
      FROM categories c LEFT JOIN categories p ON p.user_id = c.user_id AND p.id = c.parent_id
      WHERE c.user_id = ${userId}
        ${options.includeArchived ? empty : q`AND c.archived_at IS NULL`}
        ${options.kind ? q`AND c.kind = ${options.kind}` : empty}
      ORDER BY c.kind DESC, lower(coalesce(p.name, c.name)), c.parent_id IS NOT NULL, lower(c.name)`,
    'listCategories',
  )
}

export function findCategory(db: Db, userId: string, id: string): Promise<CategoryRow | null> {
  return one(
    db,
    CategoryRow,
    q`SELECT ${columns} FROM categories c LEFT JOIN categories p ON p.user_id = c.user_id AND p.id = c.parent_id
      WHERE c.user_id = ${userId} AND c.id = ${id}`,
    'findCategory',
  )
}

export type CategoryInput = { name: string; kind: CategoryKind; parentId: string | null; colour: ColourToken; icon: CategoryIcon }

export async function insertCategory(db: Db, userId: string, input: CategoryInput): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO categories (user_id, name, kind, parent_id, colour, icon)
      VALUES (${userId}, ${input.name}, ${input.kind}, ${input.parentId}, ${input.colour}, ${input.icon})
      RETURNING id`,
    'insertCategory',
  )
  return result[0]!.id
}

/** Kind can't change once created (transactions point at it with their kind). */
export async function updateCategory(db: Db, userId: string, id: string, input: Omit<CategoryInput, 'kind'>): Promise<boolean> {
  const result = await db.query(q`
    UPDATE categories SET name = ${input.name}, parent_id = ${input.parentId}, colour = ${input.colour}, icon = ${input.icon}
    WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

export async function setCategoryArchived(db: Db, userId: string, id: string, archived: boolean): Promise<boolean> {
  const result = await db.query(q`
    UPDATE categories SET archived_at = CASE WHEN ${archived}::boolean THEN coalesce(archived_at, now()) ELSE NULL END
    WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

/** Refused by the foreign keys (23503) while anything uses it; the service offers archive. */
export async function deleteCategory(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(q`DELETE FROM categories WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

/** name → id for one user (the sample data and the check script file things by name). */
export async function categoryIdsByName(db: Db, userId: string): Promise<Map<string, string>> {
  const result = await rows(db, z.object({ id: z.uuid(), name: z.string() }), q`SELECT id, name FROM categories WHERE user_id = ${userId}`, 'categoryIdsByName')
  return new Map(result.map((r) => [r.name, r.id]))
}

// ---------------------------------------------------------------------------
// Auto-categorisation rules
// ---------------------------------------------------------------------------

export const RuleRow = z.object({
  id: z.uuid(),
  pattern: z.string(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  categoryKind: z.enum(CATEGORY_KINDS),
  position: z.number().int(),
})
export type RuleRow = z.infer<typeof RuleRow>

export function listRules(db: Db, userId: string): Promise<RuleRow[]> {
  return rows(
    db,
    RuleRow,
    q`SELECT r.id, r.pattern, r.category_id AS "categoryId", c.name AS "categoryName", c.kind AS "categoryKind", r.position
      FROM categorise_rules r JOIN categories c ON c.user_id = r.user_id AND c.id = r.category_id
      WHERE r.user_id = ${userId} AND c.archived_at IS NULL
      ORDER BY r.position, lower(r.pattern)`,
    'listRules',
  )
}

export async function insertRule(db: Db, userId: string, input: { pattern: string; categoryId: string; position: number }): Promise<string> {
  const result = await rows(
    db,
    z.object({ id: z.uuid() }),
    q`INSERT INTO categorise_rules (user_id, pattern, category_id, position)
      VALUES (${userId}, ${input.pattern}, ${input.categoryId}, ${input.position}) RETURNING id`,
    'insertRule',
  )
  return result[0]!.id
}

export async function updateRule(db: Db, userId: string, id: string, input: { pattern: string; categoryId: string; position: number }): Promise<boolean> {
  const result = await db.query(q`
    UPDATE categorise_rules SET pattern = ${input.pattern}, category_id = ${input.categoryId}, position = ${input.position}
    WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}

export async function deleteRule(db: Db, userId: string, id: string): Promise<boolean> {
  const result = await db.query(q`DELETE FROM categorise_rules WHERE user_id = ${userId} AND id = ${id} RETURNING id`)
  return result.length > 0
}
