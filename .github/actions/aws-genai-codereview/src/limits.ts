export class TokenLimits {
  maxTokens: number;
  requestTokens: number;
  responseTokens: number;

  constructor(model = "anthropic.claude-instant-v1") {
    switch (model) {
      case "anthropic.claude-instant-v1":
        this.maxTokens = 100_000;
        this.responseTokens = 4000; // 4096
        break;
      case "anthropic.claude-v2":
        this.maxTokens = 100_000;
        this.responseTokens = 4000; // 4096
        break;
      case "anthropic.claude-v2:1":
        this.maxTokens = 200_000;
        this.responseTokens = 4000; // 4096
        break;
      case "anthropic.claude-3-haiku-20240307-v1:0":
        this.maxTokens = 200_000;
        this.responseTokens = 4000; // 4096
        break;
      case "anthropic.claude-3-sonnet-20240229-v1:0":
        this.maxTokens = 200_000;
        this.responseTokens = 4000; // 4096
        break;
      default:
        this.maxTokens = 200_000;
        this.responseTokens = 4000;
        break;
    }

    // provide some margin for the request tokens
    this.requestTokens = this.maxTokens - this.responseTokens - 200;
  }

  string(): string {
    return `max_tokens=${this.maxTokens}, request_tokens=${this.requestTokens}, response_tokens=${this.responseTokens}`;
  }
}
