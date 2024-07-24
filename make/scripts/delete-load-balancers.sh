#!/bin/bash

export $(grep -v '^#' .env | xargs)


# OVERRIDES
CLUSTER_NAME=
PREFERRED_REGION=
PREFERRED_PROFILE=

# Set environment variables
# WARNING: DO NOT CHANGE THESE VALUES!!!
REGION="${PREFERRED_REGION:-$AWS_REGION}"
PROFILE="${PREFERRED_PROFILE:-$AWS_PROFILE}"
CLUSTER="${CLUSTER_NAME:-$MDAI_CLUSTER_NAME}"
STACK_NAME="DecisiveEngineAwsCdkStack"
TAG_KEY="elbv2.k8s.aws/cluster"
TAG_VALUE=$CLUSTER

LB_ARNS=$(aws elbv2 describe-load-balancers --region $REGION --profile $PROFILE --query 'LoadBalancers[*]' --output text)
    
# Check if any load balancers are found
if [ -z "$LB_ARNS" ]; then
    echo "No load balancers found."
else
    # Iterate through each load balancer
    for lb_arn in $(aws elbv2 describe-load-balancers --region $REGION --profile $PROFILE --query 'LoadBalancers[*].LoadBalancerArn' --output text); do
        
        echo "GETTING TAGS FOR: $lb_arn"

        # Describe tags for each load balancer
        TAGS=$(aws elbv2 describe-tags \
            --resource-arns $lb_arn \
            --region "$REGION" \
            --profile "$PROFILE" \
            --query "TagDescriptions[0].Tags[?Key=='$TAG_KEY' && Value=='$TAG_VALUE']" \
            --output text)

        echo "TAGS FOR: $TAGS"

        # Check if the tag exists
        if [ -n "$TAGS" ]; then
            echo "Deleting load balancer $lb_arn with tag $TAG_KEY=$TAG_VALUE"

            # Delete when tag matches          
            aws elbv2 delete-load-balancer --load-balancer-arn "$lb_arn" --region "$REGION" --profile "$PROFILE"
        else
            echo "Load balancer $lb_arn does not have tag $TAG_KEY=$TAG_VALUE, skipping."
        fi
    done
fi