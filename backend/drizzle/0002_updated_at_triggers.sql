-- Maintain updated_at automatically on every row update, even from raw SQL.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER devices_set_updated_at
  BEFORE UPDATE ON "devices"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER pools_set_updated_at
  BEFORE UPDATE ON "pools"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
