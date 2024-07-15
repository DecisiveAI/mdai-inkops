#!/bin/bash

export $(grep -v '^#' .env | xargs)


# OVERRIDES

PREFERRED_REGION=
PREFERRED_PROFILE=

# Set environment variables
# WARNING: DO NOT CHANGE THESE VALUES!!!
REGION="${PREFERRED_REGION:-$AWS_REGION}"
PROFILE="${PREFERRED_PROFILE:-$AWS_PROFILE}"
STACK_NAME="DecisiveEngineAwsCdkStack"

STACK=$(aws cloudformation describe-stacks \
    --region $REGION  \
    --profile $PROFILE \
    --query "Stacks[?StackName=='DecisiveEngineAwsCdkStack'].StackId" \
    --output json)


# Check if any load balancers are found
if [ -z "$STACK" ]; then
    echo "No stack $STACK_NAME found."
else
    # DELETE STACK
    echo "Deleting stack $STACK_NAME."

    aws cloudformation delete-stack \
      --stack-name $STACK_NAME \ 
      --deletion-mode "FORCE_DELETE_STACK" \
      --profile $PROFILE \ 
      --region $REGION
fi