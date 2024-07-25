import os
import boto3
import json
import decimal
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Helper function to convert Decimal to a JSON-serializable type
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            # Convert Decimal to float
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

def handler(event, context):
    try:
        # Raw event data.
        path = event.get("rawPath", "/")
        if path != "/":
            return {
                "statusCode": 404,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"message": "Not found. Please request the root path."})
            }

        # Get a reference to the DynamoDB table.
        dynamodb = boto3.resource("dynamodb")
        table_name = os.environ.get("TABLE_NAME")
        if not table_name:
            logger.error("Environment variable TABLE_NAME not set.")
            return {
                "statusCode": 500,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"message": "Environment variable TABLE_NAME not set."})
            }

        table = dynamodb.Table(table_name)

        # Read the "visit_count" key (or create it if it doesn't exist)
        try:
            response = table.get_item(Key={"key": "visit_count"})
            if "Item" in response:
                visit_count = response["Item"]["value"]
            else:
                visit_count = 0

            # Increment the visit count and write it back to the table.
            new_visit_count = visit_count + 1
            table.put_item(Item={"key": "visit_count", "value": new_visit_count})
        except Exception as e:
            logger.error(f"Error accessing DynamoDB: {str(e)}")
            return {
                "statusCode": 500,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"message": f"Error accessing DynamoDB: {str(e)}"})
            }

        version = os.environ.get("VERSION", "0.0")
        commit_hash = os.environ.get("COMMIT_HASH", "unknown")

        response_body = {
            "message": "Hello, this demo is to show how to achieve CICD+woeioe by using github actions and AWS CDK. 👋",
            "version": version,
            "visit_count": new_visit_count,
            "commit_hash": commit_hash,
        }
        
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(response_body, cls=DecimalEncoder)
        }
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"message": f"Unexpected error: {str(e)}"})
        }
