-- READ ONLY: run ONLY after the updated Worker has been deployed and a status API request completed.
-- This file never alters the database.
SELECT name FROM sqlite_master WHERE type='table' AND name='hns_contact_statuses';
SELECT campaign_slug,contact_type,status,COUNT(*) AS records
  FROM hns_contact_statuses GROUP BY campaign_slug,contact_type,status ORDER BY contact_type,status;
