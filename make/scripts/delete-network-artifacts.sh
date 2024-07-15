#!/bin/bash

export $(grep -v '^#' .env | xargs)


# OVERRIDES
CLUSTER_NAME="test-july-11"
PREFERRED_REGION="us-east-1"
PREFERRED_PROFILE=

# Set environment variables
# WARNING: DO NOT CHANGE THESE VALUES!!!
REGION="${PREFERRED_REGION:-$AWS_REGION}"
PROFILE="${PREFERRED_PROFILE:-$AWS_PROFILE}"
CLUSTER="${CLUSTER_NAME:-$MDAI_CLUSTER_NAME}"
STACK_NAME="DecisiveEngineAwsCdkStack"
TAG_KEY="StackType"
TAG_VALUE=$STACK_NAME

VPC_IDS=$(aws ec2 describe-vpcs --profile $PROFILE --region $REGION --query 'Vpcs[*].VpcId' --output text)

# Check if any load balancers are found
# Check if any VPCs are found
if [ -z "$VPC_IDS" ]; then
    echo "No VPCs found."
else
    # Iterate through each VPC
    for vpc in $VPC_IDS; do
        # Describe tags for each VPC
        TAGS=$(aws ec2 describe-tags \
            --region "$REGION" \
            --profile "$PROFILE" \
            --filters "Name=resource-id,Values=$vpc" "Name=key,Values=$TAG_KEY" "Name=value,Values=$TAG_VALUE" \
            --query "Tags" \
            --output text)
        
        # Check if the tag exists
        if [ -n "$TAGS" ]; then
            echo "BEGIN Deleting VPC $vpc with tag $TAG_KEY=$TAG_VALUE and all artifacts"

            # Delete Nat Gateway
            for natgw_id in $(aws ec2 describe-nat-gateways --region $REGION --profile $PROFILE --query "NatGateways[?VpcId=='$vpc'].NatGatewayId" --output text); do
                aws ec2 delete-nat-gateway --nat-gateway-id $natgw_id --region $REGION --profile $PROFILE
                echo "Deleted NatGateway $natgw_id"
            done

            # Delete Security Groups
            SECURITY_GROUPS=$(aws ec2 describe-security-groups --region "$REGION" --profile "$PROFILE" --filters "Name=vpc-id,Values=$vpc" --query 'SecurityGroups[*].GroupId' --output text)
            for sg in $SECURITY_GROUPS; do
                if [[ "$sg" != "default" ]]; then
                    echo "Deleting security group $sg"
                    aws ec2 delete-security-group --group-id "$sg" --region "$REGION" --profile "$PROFILE"
                fi
            done
            
            # # Delete Network Interfaces
            NETWORK_INTERFACES=$(aws ec2 describe-network-interfaces --region "$REGION" --profile "$PROFILE" --filters "Name=vpc-id,Values=$vpc" --query 'NetworkInterfaces[*].NetworkInterfaceId' --output text)
            for ni in $NETWORK_INTERFACES; do
                echo "Deleting network interface $ni"
                aws ec2 delete-network-interface --network-interface-id "$ni" --region "$REGION" --profile "$PROFILE"
            done

            # # Delete all dependent resources before deleting the VPC
            # # Delete Subnets
            SUBNETS=$(aws ec2 describe-subnets --region "$REGION" --profile "$PROFILE" --filters "Name=vpc-id,Values=$vpc" --query 'Subnets[*].SubnetId' --output text)
            for subnet in $SUBNETS; do
                echo "Deleting subnet $subnet"
                aws ec2 delete-subnet --subnet-id "$subnet" --region "$REGION" --profile "$PROFILE"
            done
            
            # # Finally, delete the VPC
            aws ec2 delete-vpc --vpc-id "$vpc" --region "$REGION" --profile "$PROFILE"
        else
            echo "VPC $vpc does not have tag $TAG_KEY=$TAG_VALUE, skipping."
        fi
    done
fi