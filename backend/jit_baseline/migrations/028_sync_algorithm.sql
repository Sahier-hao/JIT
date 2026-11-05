ALTER TABLE repository_sync ADD COLUMN algorithm TEXT;
UPDATE repository_sync SET algorithm='logistic-regression-l2-v1'
WHERE requested_strategy IN ('auto', 'force-train');
