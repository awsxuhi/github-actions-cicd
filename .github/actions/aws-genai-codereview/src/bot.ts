import "./fetch-polyfill";

import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { info, warning } from "@actions/core";
import pRetry from "p-retry";
import { BedrockOptions, Options } from "./options";

// define type to save parentMessageId and conversationId
export interface Ids {
  parentMessageId?: string;
  conversationId?: string;
}

export class Bot {
  private readonly client: BedrockRuntimeClient;

  private readonly options: Options;
  private readonly bedrockOptions: BedrockOptions;

  constructor(options: Options, bedrockOptions: BedrockOptions) {
    this.options = options;
    this.bedrockOptions = bedrockOptions;
    this.client = new BedrockRuntimeClient({});
  }

  chat = async (message: string, prefix?: string): Promise<[string, Ids]> => {
    let res: [string, Ids] = ["", {}];
    try {
      res = await this.chat_(message, prefix);
      return res;
    } catch (e: unknown) {
      warning(`Failed to chat: ${e}`);
      return res;
    }
  };

  private readonly chat_ = async (message: string, prefix: string = ""): Promise<[string, Ids]> => {
    /*
    prefix 的作用是用来提供一个初始的上下文，作为 AI 模型的辅助信息，以指导其响应。当 prefix 有值时，它会被添加到消息列表中，作为一个模型的提示，这通常用于提供一些基础或预设的信息，让模型根据它继续生成答案。
    prefix 为 { 可能会提示模型生成与 JSON 结构或代码有关的内容。
    */
    // record timing
    const start = Date.now();
    if (!message) {
      return ["", {}];
    }

    let response: InvokeModelCommandOutput | undefined;

    message = `IMPORTANT: Entire response must be in the language with ISO code: ${this.options.language}\n\n${message}`;
    try {
      if (this.options.debug) {
        info(`sending prompt: ${message}\n------------`);
      }
      response = await pRetry(
        () =>
          this.client.send(
            new InvokeModelCommand({
              modelId: this.bedrockOptions.model,
              body: JSON.stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 4096,
                temperature: 0,
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: message,
                      },
                    ],
                  },
                  ...(prefix
                    ? [
                        {
                          role: "assistant",
                          content: [
                            {
                              type: "text",
                              text: prefix,
                            },
                          ],
                        },
                      ]
                    : []),
                ],
              }),
              contentType: "application/json",
              accept: "application/json",
            })
          ),
        {
          retries: this.options.bedrockRetries,
        }
      );
    } catch (e: unknown) {
      info(`response: ${response}, failed to send message to bedrock: ${e}`);
    }
    const end = Date.now();
    info(`response: ${JSON.stringify(response)}`);
    info(`bedrock sendMessage (including retries) response time: ${end - start} ms`);

    let responseText = "";
    if (response != null) {
      responseText = JSON.parse(Buffer.from(response.body).toString("utf-8")).content?.[0]?.text;
    } else {
      warning("bedrock response is null");
    }
    if (this.options.debug) {
      info(`bedrock responses: ${responseText}\n-----------`);
    }
    const newIds: Ids = {
      parentMessageId: response?.$metadata.requestId,
      conversationId: response?.$metadata.cfId,
    };
    return [prefix + responseText, newIds];
  };
}
