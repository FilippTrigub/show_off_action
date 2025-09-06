# Summarize and Send Changes to API Action

A GitHub Action that generates AI-powered summaries of commit changes using BlackBox AI and sends them to an external API endpoint.

## Usage

```yaml
name: Summarize and Send Changes to API
on:
  push:
    branches: [ main ]

jobs:
  summarize-and-send:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 2  # Need at least 2 commits for git diff

      - name: Summarize and Send to API
        uses: ./
        with:
          blackbox-api-key: ${{ secrets.BLACKBOX_API_KEY }}
          api-key: ${{ secrets.API_KEY }}
          api-url: 'https://your-api.com/changes'
          model: 'blackboxai'
```

### With Custom Changes Input

```yaml
jobs:
  summarize-and-send:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Get custom changes
        id: changes
        run: |
          CHANGES="Custom changes data here"
          echo "changes<<EOF" >> $GITHUB_OUTPUT
          echo "$CHANGES" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Send to API
        uses: ./
        with:
          changes: ${{ steps.changes.outputs.changes }}
          blackbox-api-key: ${{ secrets.BLACKBOX_API_KEY }}
          api-key: ${{ secrets.API_KEY }}
          api-url: 'https://your-api.com/changes'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `changes` | Optional custom changes data (if not provided, action will get latest commit) | No | - |
| `blackbox-api-key` | BlackBox AI API key for generating summaries | Yes | - |
| `api-key` | API key for authentication to target API | Yes | - |
| `api-url` | The API endpoint URL to send data to | No | `https://api.example.com/changes` |
| `model` | BlackBox AI model to use for summarization | No | `blackboxai` |

## Outputs

| Output | Description |
|--------|-------------|
| `summary` | Generated AI summary of the commit changes |
| `response` | Response body from the API call |
| `status` | HTTP status code of the API response |

## How It Works

1. **Commit Analysis**: If no custom changes are provided, the action automatically extracts data from the latest git commit including:
   - Commit message and hash
   - Changed files
   - File modification status

2. **AI Summarization**: Uses BlackBox AI to generate a structured summary focusing on:
   - What changed (functionality, files, features)
   - Why the change was made (purpose, problem solved)  
   - Impact on users or system

3. **API Delivery**: Sends the generated summary to your specified API endpoint

## API Request Format

The action sends a POST request to the `/generate-content` endpoint with the following JSON structure:

```json
{
  "summary": "• Updated user authentication flow to support OAuth2\n• Modified login.js and auth.js files\n• Improves security and user experience by enabling social login options",
  "timestamp": "2023-12-01T12:00:00.000Z"
}
```

**Note**: The action automatically appends `/generate-content` to your API URL if not already present.

## Headers

- `Content-Type: application/json`
- `Authorization: Bearer {api-key}`
- `User-Agent: GitHub-Action-Send-Changes/1.0`

## Error Handling

The action will fail if:
- Required inputs (BlackBox API key, target API key) are missing
- Git repository has no commits (when not providing custom changes)
- BlackBox AI API request fails or times out
- Target API request fails
- Request times out (30 second timeout for each API call)

## Setup Requirements

1. **BlackBox AI API Key**: Sign up at [BlackBox AI](https://blackbox.ai) and get your API key
2. **GitHub Secrets**: Store your API keys as repository secrets:
   - `BLACKBOX_API_KEY`: Your BlackBox AI API key
   - `API_KEY`: Your target API authentication key

## Development

1. Install dependencies: `npm install`
2. Make changes to `index.js`
3. Test the action locally using [act](https://github.com/nektos/act)

## License

MIT