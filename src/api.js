const API_BASE = "https://words-notion-server-jaqgk67ac6p0.wizard-today.deno.net";

async function apiFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    let error = {};

    try {
      error = await res.json();
    } catch {}

    throw new Error(
      error.error ??
      `Request failed: ${res.status} ${res.statusText}`
    );
  }

  const contentType = res.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    return res.json();
  }

  return null;
}

export class Api {
  constructor() {
    this._repeatsCache = null;
    this._categoriesCache = null;
    this._cardsCache = null;
  }

  /* ── Repeats ── */

  async getRepeats() {
    if (this._repeatsCache) {
      return this._repeatsCache;
    }

    const repeats = await apiFetch("/repeats");

    this._repeatsCache = repeats;

    return repeats;
  }

  /* ── Categories ── */

  async getCategories() {
    if (this._categoriesCache) {
      return this._categoriesCache;
    }

    const categories = await apiFetch("/categories");

    this._categoriesCache = categories;

    return categories;
  }

  async getCards() {
    if (this._cardsCache) {
      return this._cardsCache;
    }

    const cards = await apiFetch("/cards");

    this._cardsCache = cards;

    return cards;
  }

  /* ── Due cards ── */

  async getDueCards({ categoryId } = {}) {
    const params = new URLSearchParams();

    if (categoryId != null) {
      params.set("categoryId", categoryId);
    }

    const query = params.toString();

    return apiFetch(
      `/cards/due${query ? `?${query}` : ""}`
    );
  }

  /* ── Mark learned ── */

  async markCardLearned(cardId) {
    await apiFetch(`/cards/${cardId}/learned`, {
      method: "POST",
    });
  }

  /* ── Mark not learned ── */

  async markCardNotLearned(cardId) {
    await apiFetch(`/cards/${cardId}/not-learned`, {
      method: "POST",
    });
  }

  /* ── Сброс локального кеша ── */

  clearCache() {
    this._repeatsCache = null;
    this._categoriesCache = null;
  }
}