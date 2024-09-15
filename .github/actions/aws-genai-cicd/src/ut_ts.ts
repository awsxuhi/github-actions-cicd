import * as fs from 'fs';
import * as path from 'path';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { execSync } from 'child_process';
import { setTimeout } from 'timers/promises';
import { validateTestCases } from './testValidator';
import { analyzeCoverage } from './coverageAnalyzer';
import { TestCase, generateFakeResponse, createPrompt } from './testUtils';

// Remove the duplicate TestCase interface and generateFakeResponse function

export async function generateUnitTests(client: BedrockRuntimeClient, modelId: string, sourceCode: string): Promise<TestCase[]> {
    const prompt = createPrompt(sourceCode);
    console.log('Generating unit tests with total prompt length:', prompt.length);

    // Define the prompt to send to Claude
    const payload = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [{
              type: "text",
              text: prompt,
            }],
          },
        ],
      };

    const command = new InvokeModelCommand({
        // modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        modelId: modelId,
        contentType: "application/json",
        body: JSON.stringify(payload),
    });

    const timeoutMs = 45 * 1000; // 45 seconds considering the prompt length
    try {
      const apiResponse = await Promise.race([
        client.send(command),
        setTimeout(timeoutMs),
      ]);
      if (apiResponse === undefined) {
        console.log('Request timed out, returning fake response');
        return await generateFakeResponse();
      }
      const decodedResponseBody = new TextDecoder().decode(apiResponse.body);
      const responseBody = JSON.parse(decodedResponseBody);
      const finalResult = responseBody.content[0].text;
      
      try {
        const parsedTestCases = JSON.parse(finalResult.replace(/\n/g, '\\n')) as TestCase[];
        if (!Array.isArray(parsedTestCases)) {
            throw new Error('Parsed result is not an array');
        }
        const validatedTestCases = await validateTestCases(parsedTestCases, sourceCode);
        console.log('Generated and validated test cases:', validatedTestCases);
        return validatedTestCases;
      } catch (error) {
          console.error('Failed to parse or validate AI response:', error);
          console.log('Raw AI response:', finalResult);
          // Attempt to extract test cases manually in consideration of the inconsistent format of the AI response
          const extractedTestCases = extractTestCases(finalResult);
          if (extractedTestCases.length > 0) {
              console.log('Extracted test cases manually:', extractedTestCases);
              return extractedTestCases;
          }
          return [];
      }
    } catch (error) {
      console.error('Error occurred while generating unit tests:', error);
      return [];
    }
}

function extractTestCases(rawResponse: string): TestCase[] {
    const testCases: TestCase[] = [];
    const regex = /\{\s*"name":\s*"([^"]+)",\s*"type":\s*"([^"]+)",\s*"code":\s*"([^"]*)"\s*\}/g;
    let match;
    while ((match = regex.exec(rawResponse)) !== null) {
        if (match[1] && match[2] && match[3]) {
            testCases.push({
                name: match[1],
                type: match[2] as 'direct' | 'indirect' | 'not-testable',
                code: match[3].replace(/\\n/g, '\n').replace(/\\"/g, '"')
            });
        }
    }
    return testCases;
}

export async function runUnitTests(testCases: TestCase[], sourceCode: string): Promise<void> {
    if (!Array.isArray(testCases) || testCases.length === 0) {
        console.log('Input test cases', testCases);
        console.log('No test cases to run');
        return;
    }
    // note this is the temporary directory for storing the generated test cases while the actual test cases pushed to the repo are 'test/unit_tests.ts' handled the main function
    const testDir = path.join(__dirname, '..', 'generated_tests');
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }
    console.log('Writing test cases to:', testDir, testCases);
    const testFilePath = path.join(testDir, 'generated.test.ts');
    const testFileContent = testCases
        .filter(tc => tc.type !== 'not-testable')
        .map(tc => tc.code)
        .join('\n\n');

    fs.writeFileSync(testFilePath, testFileContent);

    try {
        // log out the execution result of the test
        execSync(`npx jest ${testFilePath}`, { stdio: 'inherit' });
        console.log('Tests passed successfully');
        const coverage = await analyzeCoverage(testFilePath, sourceCode);
        console.log('Test coverage:', coverage);
    } catch (error) {
        console.error('Error running tests:', error);
    }
}

export async function generateTestReport(testCases: TestCase[]): Promise<void> {
    if (!Array.isArray(testCases)) {
        console.log('Invalid test cases input. Skipping report generation.');
        return;
    }
    const report = {
        totalTests: testCases.length,
        directTests: testCases.filter(tc => tc.type === 'direct').length,
        indirectTests: testCases.filter(tc => tc.type === 'indirect').length,
        notTestable: testCases.filter(tc => tc.type === 'not-testable').length,
    };

    const reportDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // TODO: upload the artifact from the report directory as an artifact named "logs", using actions/upload-artifact@v4
    console.log('Test report generated:', report);
}