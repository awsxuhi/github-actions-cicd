import os
import boto3


def handler(event, context):
    # Raw event data.
    # Checks whether the requested path is the root path ("/"). If the path is not the root path, the function immediately returns with an HTTP 404 status code and a "Not found." message.
    path = event["rawPath"]
    if path != "/":
        return {"statusCode": 404, "body": "Not found. Please request the root path."}

    # Get a reference to the DDB table.
    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(os.environ.get("TABLE_NAME"))

    # Read the "VISIT COUNT" key (or create it if it doesn't exist)
    response = table.get_item(Key={"key": "visit_count"})
    if "Item" in response:
        visit_count = response["Item"]["value"]
    else:
        visit_count = 0

    # Increment the visit count and write it back to the table.
    new_visit_count = visit_count + 1
    table.put_item(Item={"key": "visit_count", "value": new_visit_count})

    version = os.environ.get("VERSION", "0.0")
    response_body = {
        "message": "Hello, this demo is to show how to achieve CICD by using github actions and AWS CDK. 👋",
        "version": version,
        "visit_count": new_visit_count,
    }
    return {"statusCode": 200, "body": response_body}
