package main

import (
	"errors"
	"gopkg.in/yaml.v3"
	"os"
)

func nodesEqual(l, r *yaml.Node) bool {
	if l.Kind == yaml.ScalarNode && r.Kind == yaml.ScalarNode {
		return l.Value == r.Value
	}
	panic("equals on non-scalars not implemented!")
}

func recursiveMerge(from, into *yaml.Node) error {
	if from.Kind != into.Kind {
		return errors.New("cannot merge nodes of different kinds")
	}
	switch from.Kind {
	case yaml.MappingNode:
		for i := 0; i < len(from.Content); i += 2 {
			found := false
			for j := 0; j < len(into.Content); j += 2 {
				if nodesEqual(from.Content[i], into.Content[j]) {
					found = true
					if err := recursiveMerge(from.Content[i+1], into.Content[j+1]); err != nil {
						return errors.New("at key " + from.Content[i].Value + ": " + err.Error())
					}
					break
				}
			}
			if !found {
				into.Content = append(into.Content, from.Content[i:i+2]...)
			}
		}
	case yaml.SequenceNode:
		into.Content = append(into.Content, from.Content...)
	case yaml.DocumentNode:
		return recursiveMerge(from.Content[0], into.Content[0])
	case yaml.ScalarNode:
		into.Content = append(into.Content, from.Content...)
	default:
		return errors.New("can only merge mapping and sequence nodes")
	}
	return nil
}

func parseOtel(tfn, cfn, pfn, ofn string) error {
	// template file
	tf, err := os.ReadFile(tfn)
	if err != nil {
		return err
	}
	// values file
	vf, err := os.ReadFile(pfn)
	if err != nil {
		return err
	}
	// output file
	of, err := os.Create(ofn)
	if err != nil {
		return err
	}
	// otel config file
	cf, err := os.ReadFile(cfn)
	if err != nil {
		return err
	}

	var v1, v2 yaml.Node
	yaml.Unmarshal(tf, &v1)
	yaml.Unmarshal(vf, &v2)
	if err := recursiveMerge(&v1, &v2); err != nil {
		return err
	}
	// add collector config here
	cfgN, err := composeConfig(cf)
	if err != nil {
		return err
	}
	if err := recursiveMerge(&cfgN, &v2); err != nil {
		return err
	}
	e := yaml.NewEncoder(of)
	e.Encode(&v2)
	e.Close()

	return nil
}

func composeConfig(cfgB []byte) (yaml.Node, error) {
	type PartCfg struct {
		Config string `yaml:"config"`
	}
	type PartCR struct {
		Spec PartCfg `yaml:"spec"`
	}
	var cr = PartCR{Spec: PartCfg{Config: string(cfgB)}}
	var cfgN yaml.Node

	crB, err := yaml.Marshal(cr)
	if err != nil {
		return cfgN, err
	}
	err = yaml.Unmarshal(crB, &cfgN)
	if err != nil {
		return cfgN, err
	}
	return cfgN, nil
}
