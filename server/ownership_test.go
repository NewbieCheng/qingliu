package main

import "testing"

func TestNormalizeOwnershipRelationship(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"Self", "Self", true},
		{"本人", "Self", true},
		{" 本人 ", "Self", true},
		{"配偶", "配偶", true},
		{"Spouse", "配偶", true},
		{"子女", "子女", true},
		{"Child", "子女", true},
		{"Other", "Other", true},
		{"其他", "Other", true},
		{"", "", false},
		{"朋友", "", false},
	}
	for _, c := range cases {
		got, ok := normalizeOwnershipRelationship(c.in)
		if got != c.want || ok != c.ok {
			t.Fatalf("normalizeOwnershipRelationship(%q) = (%q, %v), want (%q, %v)", c.in, got, ok, c.want, c.ok)
		}
	}
}
