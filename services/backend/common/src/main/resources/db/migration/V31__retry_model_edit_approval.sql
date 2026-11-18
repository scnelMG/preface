ALTER TABLE face_model
    ADD COLUMN edit_approval_retry JSON NULL,
    ADD COLUMN edit_approval_retry_at DATETIME(6) NULL,
    ADD INDEX ix_face_model_edit_approval_retry (edit_approval_retry_at);
