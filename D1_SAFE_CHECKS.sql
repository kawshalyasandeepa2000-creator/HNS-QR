-- READ-ONLY: cloudflare -> D1 -> qr-referral-d1 -> Console
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
SELECT campaign_slug, COUNT(*) AS total FROM referrals GROUP BY campaign_slug;
PRAGMA table_info(referrals);
-- Optional if tables exist (no rows or columns are changed):
SELECT COUNT(*) AS csv_references FROM csv_reference_contacts;
SELECT COUNT(*) AS scan_cards FROM business_card_leads;
