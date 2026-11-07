ALTER TABLE training_task ADD COLUMN metrics_by_partition_json TEXT;
ALTER TABLE training_task ADD COLUMN split_json TEXT;
ALTER TABLE training_task ADD COLUMN split_rule TEXT;
ALTER TABLE training_task ADD COLUMN data_scale_json TEXT;
ALTER TABLE training_task ADD COLUMN training_performance_json TEXT;
