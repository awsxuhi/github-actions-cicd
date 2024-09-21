# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template

## About demo

All the files in the `src` directory under the project's root are used to demonstrate how to use GenAI in a CI/CD pipeline. A script is used to modify these files and automatically commit the changes to the `dev` branch, which then triggers a pull request from `dev` to `main`. Therefore, it's important to note that the files in this directory are demo files, and they can be deleted or replaced at will.

xuhi
2024-09-21
