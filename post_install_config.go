package main

import (
	"context"
	"encoding/json"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	"path/filepath"
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

	if err = json.Unmarshal(mapRolesBytes, &mapRoles); err != nil {
		return err
	}

	found := false
	for i, mapRole := range mapRoles {
		if mapRole.Rolearn == roleArn {
			mapRoles[i] = MapRole{Rolearn: roleArn,
				Username: "cluster-admin",
				Groups:   []string{"system:masters"},
			}
			found = true
		}
	}
	if !found {
		mapRoles = append(mapRoles, MapRole{Rolearn: roleArn,
			Username: "cluster-admin",
			Groups:   []string{"system:masters"},
		},
		)
	}

	mapRolesBytes, err = json.Marshal(mapRoles)

	cM.Data["mapRoles"] = string(mapRolesBytes)

	cM, err = clientset.CoreV1().ConfigMaps("kube-system").Update(context.TODO(), cM, metav1.UpdateOptions{})
	if err != nil {
		return err
	}
	return nil
}
