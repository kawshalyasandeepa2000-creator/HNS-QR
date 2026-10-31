-- Cloudflare D1 database schema (SQLite dialect).
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_slug TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  visitor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_slug, visitor_hash)
);
CREATE INDEX IF NOT EXISTS idx_campaign_recent ON referrals(campaign_slug, id DESC);

-- To check data in Cloudflare D1:
-- SELECT id, code, campaign_slug, created_at FROM referrals ORDER BY id DESC LIMIT 20;
