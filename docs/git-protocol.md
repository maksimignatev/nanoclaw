# Git-Based Communication Protocol

This document describes how to use the nanoclaw repository as a git-based interface for issuing instructions and receiving responses.

## Overview

The git-based communication protocol allows you to:
1. Push request files to the repository
2. Have GitHub Actions automatically process them
3. Receive responses committed back to the repository

This provides a simple, auditable, and version-controlled way to interact with automated processing workflows.

## Directory Structure

```
nanoclaw/
├── requests/
│   └── <request-id>/
│       ├── request.md       # Required: your instruction/request
│       └── context/         # Optional: additional context files
│           └── ...
└── responses/
    └── <request-id>/
        ├── response.md      # Generated: the response to your request
        └── status.json      # Generated: processing metadata
```

## Request ID Format

A request ID should be unique and descriptive. We recommend the format:

```
<timestamp>-<slug>
```

Examples:
- `20260213-analyze-logs`
- `20260213-143000-update-readme`
- `2026-02-13-bug-fix-request`

The timestamp ensures uniqueness, and the slug provides human readability.

## How to Create a Request

### Step 1: Create Request Directory

```bash
# Navigate to your local clone
cd nanoclaw

# Create a new request directory with a unique ID
REQUEST_ID="$(date +%Y%m%d-%H%M%S)-my-task"
mkdir -p "requests/$REQUEST_ID"
```

### Step 2: Write Your Request

Create `requests/<request-id>/request.md`:

```bash
cat > "requests/$REQUEST_ID/request.md" << 'EOF'
# My Request Title

Please analyze the following scenario and provide recommendations.

## Context

[Your context here]

## Question

[Your question here]
EOF
```

### Step 3: (Optional) Add Context Files

If you need to provide additional files:

```bash
mkdir -p "requests/$REQUEST_ID/context"
cp /path/to/your/file.txt "requests/$REQUEST_ID/context/"
```

### Step 4: Commit and Push

```bash
git add "requests/$REQUEST_ID"
git commit -m "Add request: $REQUEST_ID"
git push origin main
```

## How Processing Works

1. **Trigger**: When you push changes to `requests/**`, GitHub Actions detects the change
2. **Check**: The workflow checks if you've added new requests (directories in `requests/` without corresponding `responses/`)
3. **Process**: For each new request, the runner script:
   - Reads `request.md`
   - Generates `response.md` (echoes the request with metadata)
   - Creates `status.json` with processing details
4. **Commit**: The workflow commits the responses back to the repository
5. **Loop Prevention**: The workflow skips commits made by `github-actions[bot]` to prevent infinite loops

## How to Fetch Responses

### Pull Latest Changes

```bash
git pull origin main
```

### View Response

```bash
cat "responses/$REQUEST_ID/response.md"
cat "responses/$REQUEST_ID/status.json"
```

## Response Format

### response.md

The response echoes back your original request along with processing metadata:

```markdown
# Response to Request: <request-id>

## Original Request

[Your original request content]

## Processing Metadata

- **Processed at:** 2026-02-13T14:30:00.000Z
- **Source commit:** abc1234567890
- **Request ID:** <request-id>
```

### status.json

The status file contains structured metadata:

```json
{
  "request_id": "20260213-my-task",
  "processed_at": "2026-02-13T14:30:00.000Z",
  "source_commit": "abc1234567890",
  "status": "completed"
}
```

## Example Workflow

Here's a complete example:

```bash
# Clone the repository
git clone https://github.com/maksimignatev/nanoclaw.git
cd nanoclaw

# Create a request
REQUEST_ID="20260213-example"
mkdir -p "requests/$REQUEST_ID"

cat > "requests/$REQUEST_ID/request.md" << 'EOF'
# Example Request

This is a test request to verify the git-based communication protocol.

Please confirm that this request was received and processed successfully.
EOF

# Commit and push
git add "requests/$REQUEST_ID"
git commit -m "Add example request"
git push origin main

# Wait a few seconds for GitHub Actions to process...

# Pull the response
git pull origin main

# View the response
cat "responses/$REQUEST_ID/response.md"
cat "responses/$REQUEST_ID/status.json"
```

## Limitations and Security Notes

### Current Limitations

1. **Simple Echo Response**: The current implementation simply echoes back the request with metadata. This is a proof-of-concept; actual processing logic can be added to the runner script.

2. **Synchronous Processing**: Requests are processed synchronously. Large batches may take time.

3. **No Retry Logic**: Failed requests must be manually re-pushed.

4. **Main Branch Only**: Currently only processes requests pushed to the `main` branch.

### Security Considerations

1. **Public Repository**: If your repository is public, anyone can see your requests and responses. Use a private repository for sensitive data.

2. **GitHub Actions Access**: The workflow uses `GITHUB_TOKEN` which has write access to the repository. Review the workflow file before enabling.

3. **Code Execution**: The runner script executes on GitHub's infrastructure. Review `scripts/process-requests.js` to understand what it does.

4. **Rate Limits**: GitHub Actions has usage limits. Excessive requests may hit these limits.

### Best Practices

- Use descriptive request IDs with timestamps
- Keep requests focused and specific
- Don't commit sensitive information to requests
- Review responses after they're generated
- Use a private repository if dealing with sensitive data

## Troubleshooting

### Request Not Processed

1. Check GitHub Actions workflow run status in the repository's "Actions" tab
2. Verify the request directory structure is correct
3. Ensure `request.md` exists and is not empty
4. Check that you pushed to the `main` branch

### Workflow Not Triggering

1. Verify changes were pushed to `requests/**` path
2. Check if the commit was made by `github-actions[bot]` (these are skipped)
3. Look for errors in the Actions tab

### Response Already Exists

The workflow is idempotent - it won't recreate responses for requests that already have them. If you need to reprocess:

1. Delete the corresponding `responses/<request-id>/` directory
2. Commit and push the deletion
3. The next workflow run will regenerate the response

## Extending the System

The current implementation is intentionally simple. You can extend it by:

1. **Modifying `scripts/process-requests.js`**: Add actual processing logic instead of just echoing
2. **Adding New Response Types**: Create additional files in the response directory
3. **Integrating External APIs**: Make API calls during processing (requires secrets management)
4. **Custom Workflows**: Create additional workflow files for different types of requests

See the runner script source code for implementation details.
