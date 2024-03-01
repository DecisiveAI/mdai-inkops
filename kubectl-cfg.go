package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

func runKubectlCfg(cdkOutput, kubectlCfgCommand string) (err error) {
	var inFile, outFile *os.File
	if inFile, err = os.Open(cdkOutput); err != nil {
		return err
	}
	defer inFile.Close()

	if outFile, err = os.Create(kubectlCfgCommand); err != nil {
		return err
	}
	defer outFile.Close()

	var outs map[string]any

	byteValue, _ := io.ReadAll(inFile)
	if err = json.Unmarshal(byteValue, &outs); err != nil {
		return err
	}

	keysValues := make(map[string]any)
	for k := range outs {
		if strings.HasSuffix(k, "AwsCdkStack") {
			var ok bool
			if keysValues, ok = outs[k].(map[string]any); !ok {
				return errors.New("type assertion failed")
			}
		}
	}
	if len(keysValues) == 0 {
		return errors.New("no AwkCdkStack in json")
	}

	for k := range keysValues {
		if strings.Contains(k, "ClusterConfigCommand") {
			outFile.WriteString(keysValues[k].(string))
			fmt.Println(keysValues[k])
		}
	}

	return nil
}
