-- Reuse the set_updated_at() function from migration 0002 for the challenge tables.
CREATE TRIGGER challenge_days_set_updated_at
  BEFORE UPDATE ON "challenge_days"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER challenge_entries_set_updated_at
  BEFORE UPDATE ON "challenge_entries"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
