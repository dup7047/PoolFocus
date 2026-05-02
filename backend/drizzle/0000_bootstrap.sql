-- 1.2a bootstrap migration: prove the migrator runs end-to-end
-- and enable pgcrypto for gen_random_uuid() used by future tables.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
