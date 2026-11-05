package main

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestPrivatePDFParity(t *testing.T) {
	manifest := os.Getenv("PARITY_MANIFEST")
	if manifest == "" {
		t.Skip("private fixtures are excluded from delivery")
	}
	b, e := os.ReadFile(manifest)
	if e != nil {
		t.Fatal(e)
	}
	var entries []struct {
		Path            string
		Rows            int
		Income, Expense int64
		Status, Source  string
		Details         []struct {
			Date, Time, Direction, Tid, Label string
			Income, Expense                   *int64
		}
	}
	if e = json.Unmarshal(b, &entries); e != nil {
		t.Fatal(e)
	}
	for i, entry := range entries {
		t.Run(string(rune('A'+i)), func(t *testing.T) {
			b, e := os.ReadFile(entry.Path)
			if e != nil {
				t.Fatal(e)
			}
			r, e := parseFile(context.Background(), b, "statement.pdf", "other", false, func(int, int) {})
			if e != nil {
				t.Fatal(e)
			}
			if len(entry.Details) > 0 {
				if len(entry.Details) != len(r.Rows) {
					t.Fatal("row count mismatch")
				}
				financialDifferences, labelDifferences := 0, 0
				for j, row := range r.Rows {
					old := entry.Details[j]
					if str(row, "date") != old.Date || str(row, "time") != old.Time || str(row, "direction") != old.Direction || str(row, "transaction_id") != old.Tid || (old.Income != nil && integer(row["income"]) != *old.Income) || (old.Expense != nil && integer(row["expense"]) != *old.Expense) {
						financialDifferences++
						if financialDifferences <= 2 {
							t.Logf("row %d date=%s/%s time=%s/%s direction=%s/%s tidLengths=%d/%d", j, str(row, "date"), old.Date, str(row, "time"), old.Time, str(row, "direction"), old.Direction, len(str(row, "transaction_id")), len(old.Tid))
						}
					}
					label, _, _ := classify(row, defaultRules())
					if label != old.Label {
						labelDifferences++
						if labelDifferences <= 2 {
							t.Logf("row %d label=%s/%s memo=%s channel=%s", j, label, old.Label, str(row, "memo"), str(row, "channel"))
						}
					}
				}
				t.Logf("financial row differences=%d default label differences=%d", financialDifferences, labelDifferences)
				if financialDifferences > 0 || labelDifferences > 0 {
					t.Errorf("row-level migration mismatch")
				}
			}
			var inc, exp int64
			for _, row := range r.Rows {
				inc += integer(row["income"])
				exp += integer(row["expense"])
			}
			t.Logf("source=%s status=%s rows=%d/%d income=%d/%d expense=%d/%d", str(r.Meta, "source"), str(r.Meta, "status"), len(r.Rows), entry.Rows, inc, entry.Income, exp, entry.Expense)
			if len(r.Rows) != entry.Rows || inc != entry.Income || exp != entry.Expense {
				t.Errorf("legacy parity mismatch")
			}
		})
	}
}
