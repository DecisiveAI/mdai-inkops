package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"

	"gopkg.in/yaml.v3"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type MapRole struct {
	Rolearn  string   `json:"rolearn"`
	Username string   `json:"username"`
	Groups   []string `json:"groups"`
}

func addRoleMapping(roleArn string) error {
	kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")

	// use the current context in kubeconfig
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return err
	}

	// create the clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return err
	}

	cM, err := clientset.CoreV1().ConfigMaps("kube-system").Get(context.TODO(), "aws-auth", metav1.GetOptions{})
	if err != nil {
		return err
	}

	mapRolesBytes := []byte(cM.Data["mapRoles"])

	var mapRoles []MapRole

	if errJSON := json.Unmarshal(mapRolesBytes, &mapRoles); errJSON != nil {
		if errYAML := yaml.Unmarshal(mapRolesBytes, &mapRoles); errYAML != nil {
			return fmt.Errorf("failed to unmarshal mapRoles: json error: %w, yaml error: %w", errJSON, errYAML)
		}
	}

	found := false
	for i, mapRole := range mapRoles {
		if mapRole.Rolearn == roleArn {
			mapRoles[i] = MapRole{
				Rolearn:  roleArn,
				Username: "cluster-admin",
				Groups:   []string{"system:masters"},
			}
			found = true
			break
		}
	}
	if !found {
		mapRoles = append(mapRoles, MapRole{
			Rolearn:  roleArn,
			Username: "cluster-admin",
			Groups:   []string{"system:masters"},
		},
		)
	}

	mapRolesBytes, err = json.Marshal(mapRoles)
	if err != nil {
		return err
	}

	cM.Data["mapRoles"] = string(mapRolesBytes)

	_, err = clientset.CoreV1().ConfigMaps("kube-system").Update(context.TODO(), cM, metav1.UpdateOptions{})
	return err
}
