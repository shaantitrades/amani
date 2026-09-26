import { z } from 'zod';

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(20),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

export function readPage(query) {
  const parsed = pageSchema.safeParse(query || {});
  if (!parsed.success) return { limit: 20, offset: 0 };
  return parsed.data;
}

export function paged(items, { limit, offset, total }) {
  return {
    items,
    page: {
      limit,
      offset,
      count: items.length,
      total: typeof total === 'number' ? total : undefined,
      nextOffset: typeof total === 'number' && offset + items.length < total ? offset + items.length : null,
    },
  };
}

/** Curseur temporel (plus fiable que l'offset sur un fil qui bouge). */
export function readCursor(query) {
  const cursor = query?.cursor ? String(query.cursor) : null;
  const limit = Math.min(Math.max(Number(query?.limit) || 20, 1), 60);
  return { cursor, limit };
}
