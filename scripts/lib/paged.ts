// Every row of a PostgREST read, a page at a time. Supabase caps one
// response at 1,000 rows whatever range the client asks for, so a read that
// needs the whole table (her sheet is longer than that) walks it in pages
// and stops at the first short one. Pure: the caller supplies the page read.

export const PAGE = 1000;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  page: number = PAGE,
): Promise<T[]> {
  if (!Number.isInteger(page) || page < 1) throw new Error(`page must be a positive integer, got ${page}`);
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const rows = await fetchPage(from, from + page - 1);
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}
