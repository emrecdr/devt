CREATE VIRTUAL TABLE IF NOT EXISTS lessons USING fts5(
  description,
  category,
  tags,
  evidence,
  importance UNINDEXED,
  confidence UNINDEXED,
  decay_days UNINDEXED,
  created_at UNINDEXED
);
