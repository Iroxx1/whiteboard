-- Full-text search (PLAN.md 5.9). Trigram finds word parts ("tür" → "Haustür"); the app keeps the
-- index up to date (no triggers). doc_type: 'item' | 'board' | 'board_text'.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
	title,
	body,
	doc_type UNINDEXED,
	doc_id UNINDEXED,
	board_id UNINDEXED,
	tokenize = 'trigram remove_diacritics 1'
);
