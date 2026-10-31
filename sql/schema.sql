CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_slug TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  visitor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_slug, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_referrals_campaign_created
  ON referrals (campaign_slug, created_at DESC);

-- Example: see all codes, latest first:
-- SELECT code, campaign_slug, created_at FROM referrals ORDER BY id DESC;
-- Example: total codes for a campaign:
-- SELECT COUNT(*) FROM referrals WHERE campaign_slug = 'outdoor-2026';
