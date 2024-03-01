package main

import (
	"errors"
	"os"
)

type Cdk struct {
	Eks Eks `yaml:"eksCluster"`
}
type Eks struct {
	EngineNamespace  string `yaml:"engineNamespace"`
	DefaultCapacity  int    `yaml:"defaultCapacity"`
	Ec2InstanceClass string `yaml:"instanceClass"`
	Ec2InstanceSize  string `yaml:"instanceSize"`
}

var (
	// parameters values
	pfnOtel = os.Getenv("PARAMS_OTEL_FILE")
	// templates
	tfnOtel    = os.Getenv("OTEL_TMPL_FILE")
	tfnOtelCfg = os.Getenv("OTELCOL_CFG_FILE")
	// out files
	ofnOtel = os.Getenv("OTELCOL_OUT_FILE")

	cdkOut        = os.Getenv("CDK_OUTPUTS_FILE")
	kubectlCfgCmd = os.Getenv("KUBECTL_CFG_CMD")
	roleArn       = os.Getenv("AWS_SSO_ROLE")
)

func main() {
	if len(os.Args) != 2 {
		panic("single mandatory argument missing: [aws|cdk|otel|kubecfg]")
	}
	var err error
	switch os.Args[1] {
	case "otel":
		err = parseOtel(tfnOtel, tfnOtelCfg, pfnOtel, ofnOtel)
	case "kubecfg":
		err = runKubectlCfg(cdkOut, kubectlCfgCmd)
	case "ekscfg":
		err = addRoleMapping(roleArn)
	default:
		err = errors.New("single mandatory argument missing: [aws|otel|kubecfg]")
	}

	if err != nil {
		panic(err.Error())
	}
}
