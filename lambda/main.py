import os
import boto3
# import json

def handler(event, context):
    # Raw event data.
    path = event.get("rawPath")
    if path != "/":
        return {"statusCode": 404, "body": "Not found. Please request the root path."}

    # Get a reference to the DynamoDB table.
    dynamodb = boto3.resource("dynamodb")
    table_name = os.environ.get("TABLE_NAME")
    if not table_name:
        return {"statusCode": 500, "body": "Environment variable TABLE_NAME not set."}

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
        return {"statusCode": 500, "body": f"Error accessing DynamoDB: {str(e)}"}

    version = os.environ.get("VERSION", "0.0")
    commit_hash = os.environ.get("COMMIT_HASH", "unknown")

    response_body = {
        "message": "Hello, this demo is to show how to achieve CICD+woeioe by using github actions and AWS CDK. 👋",
        "version": version,
        "visit_count": new_visit_count,
        "commit_hash": commit_hash,
    }
    
    return {"statusCode": 200, "body": response_body}
    # return {
    #     "statusCode": 200,
    #     "body": json.dumps(response_body)  # Ensure the response body is JSON serialized
    # }
