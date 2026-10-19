DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TableSession"
    WHERE "status" IN ('OPEN', 'CLOSING')
    GROUP BY "tableId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active table session: duplicate OPEN/CLOSING sessions exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "TableSession_one_active_per_table_key"
ON "TableSession" ("tableId")
WHERE "status" IN ('OPEN', 'CLOSING');
