// Pagination simple des listes : une page de dix lignes, bornes comprises.

export const PAGE_SIZE = 10

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / size))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * size
  return { items: items.slice(start, start + size), totalPages, currentPage, start }
}
