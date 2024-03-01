package main

import (
	"fmt"
	"gopkg.in/yaml.v3"
	"testing"
)

type Test struct {
	name     string
	template []byte
	values   []byte
	result   []byte
}

func TestMergeOtelYamls(t *testing.T) {
	// Defining the columns of the table
	var tests = []Test{
		// the table itself
		{name: "test1",
			template: []byte(`
s:
  i:
    a:
      a1: v1
      a2: _tt
    b: c
            `),
			values: []byte(`
s:
  i:
    a:
      a2: v4
    d:
      e:
        f1: v1
        f2: v2
             `),
			result: []byte(`
s:
  i:
    a:
      a1: v1
      a2: v4
    d:
      e:
        f1: v1
        f2: v2
    b: c
        `)},
		{name: "test2",
			template: []byte(`
s:
  i:
    a:
      a1: v1
      a2: _tt
            `),
			values: []byte(`
s:
  i:
    a:
      a2: v4
    d:
      e:
        f1: v1
        f2: v2
    b: c
             `),
			result: []byte(`
s:
  i:
    a:
      a1: v1
      a2: v4
    d:
      e:
        f1: v1
        f2: v2
    b: c
        `)},
		{name: "test3",
			template: []byte(`
s:
  i:
    a:
      a1: v1
      a2: _tt
    b: _tt
            `),
			values: []byte(`
s:
  i:
    a:
      a2: v4
    d:
      e:
        f1: v1
        f2: v2
    b: c
             `),
			result: []byte(`
s:
  i:
    a:
      a1: v1
      a2: v4
    d:
      e:
        f1: v1
        f2: v2
    b: c
        `)},
	}
	// The execution loop
	for _, tt := range tests {
		var tmpl, val, res yaml.Node
		var ival, ires any
		yaml.Unmarshal(tt.template, &tmpl)
		yaml.Unmarshal(tt.values, &val)
		yaml.Unmarshal(tt.result, &res)
		yaml.Unmarshal(tt.result, &ires)

		t.Run(tt.name, func(t *testing.T) {
      var err error
			if err = recursiveMerge(&tmpl, &val); err != nil {
				t.Errorf("can not merge template: %v\n and values %v\n, Error: %s", tmpl, val, err.Error())
			}
			if err = val.Decode(&ival); err != nil {
				t.Errorf("can not Decode yaml Node: %v\nError: %s", &val, err.Error())
			}
			sres := fmt.Sprint(ires)
			sval := fmt.Sprint(ival)
			if sres != sval {
				t.Errorf("got %v, want %v", ires, ival)
			}
		})
	}
}
