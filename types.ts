interface Card {
  id: string;
  question: string;
  answer: string;
  comment: string;
  category: { id: string } | null;
  repeat_date_timestamp: number; // дата следующего повторения, в Notion называется repeat_date
  repeat_after: { id: string } | null; // интервал следующего повторения
}

interface Category {
  id: string;
  name: string;
  short_name: string;
  cards_count: number;              // карточки ТОЛЬКО в этой категории (без вложенных)
  repeat_cards_count: number;       // карточки ТОЛЬКО в этой категории (без вложенных), готовые к повторению (<= cards_count)
  nested: Category[];               // вложенные категории
}

interface Repeat {
  id: string;
  duration: string;  // название, например "1 день"
  timestamp: number; // прибавляется к now() в repeat_date, например 86_400_000
}

class Api {
  /** Категории (древовидная структура) */
  async getCategories(): Promise<Category[]>;

  /** Список интервалов повторения, отсортированные по Repeat.timestamp */
  async getRepeats(): Promise<Repeat[]>;

  /** Карточки, чья repeat_date <= now() */
  async getRepeatCards(opts?: { categoryId?: string }): Promise<Card[]>;

  /** Все карточки (включая ещё не готовые к повторению) */
  async getAllCards(opts?: { categoryId?: string }): Promise<Card[]>;

  /** Карточка была выучена: обновить repeat_date и repeat_after по алгоритму повторения */
  async markCardLearned(cardId: string, repeat_date_timestamp: number, repeat_after: { id: string }): Promise<void>;

  /** Карточка провалена: сбросить интервал (repeat_date = null && repeat_after = null) */
  async markCardNotLearned(cardId: string): Promise<void>;
}