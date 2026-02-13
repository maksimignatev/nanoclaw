#!/usr/bin/env node

/**
 * Git-based request processor
 * 
 * Scans requests/ directory for new requests (those without corresponding responses/)
 * and generates deterministic responses with metadata.
 */

import { readdir, readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const REQUESTS_DIR = join(ROOT_DIR, 'requests');
const RESPONSES_DIR = join(ROOT_DIR, 'responses');

/**
 * Get current git commit SHA
 */
function getCommitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get current timestamp in ISO format
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Check if a path exists
 */
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all request IDs from requests/ directory
 */
async function getRequestIds() {
  try {
    const entries = await readdir(REQUESTS_DIR, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Check if a request has already been processed
 */
async function hasResponse(requestId) {
  const responsePath = join(RESPONSES_DIR, requestId, 'response.md');
  return await exists(responsePath);
}

/**
 * Read request content
 */
async function readRequest(requestId) {
  const requestPath = join(REQUESTS_DIR, requestId, 'request.md');
  try {
    return await readFile(requestPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read request ${requestId}: ${error.message}`);
  }
}

/**
 * Process a single request and generate response
 */
async function processRequest(requestId) {
  console.log(`Processing request: ${requestId}`);
  
  // Read the request content
  const requestContent = await readRequest(requestId);
  
  // Generate response metadata
  const timestamp = getTimestamp();
  const commitSha = getCommitSha();
  
  // Create response content (echo back the request with metadata)
  const responseContent = `# Response to Request: ${requestId}

## Original Request

${requestContent}

## Processing Metadata

- **Processed at:** ${timestamp}
- **Source commit:** ${commitSha}
- **Request ID:** ${requestId}
`;

  // Create status object
  const status = {
    request_id: requestId,
    processed_at: timestamp,
    source_commit: commitSha,
    status: 'completed'
  };
  
  // Ensure response directory exists
  const responseDir = join(RESPONSES_DIR, requestId);
  await mkdir(responseDir, { recursive: true });
  
  // Write response.md
  const responsePath = join(responseDir, 'response.md');
  await writeFile(responsePath, responseContent, 'utf8');
  console.log(`  ✓ Created ${responsePath}`);
  
  // Write status.json
  const statusPath = join(responseDir, 'status.json');
  await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Created ${statusPath}`);
  
  return { requestId, status };
}

/**
 * Main processing loop
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Git-based Request Processor');
  console.log('='.repeat(60));
  console.log();
  
  // Get all request IDs
  const requestIds = await getRequestIds();
  console.log(`Found ${requestIds.length} request(s)`);
  
  if (requestIds.length === 0) {
    console.log('No requests to process.');
    return;
  }
  
  // Filter to only new requests (without responses)
  const newRequests = [];
  for (const requestId of requestIds) {
    const alreadyProcessed = await hasResponse(requestId);
    if (!alreadyProcessed) {
      newRequests.push(requestId);
    } else {
      console.log(`Skipping ${requestId} (already processed)`);
    }
  }
  
  console.log(`Processing ${newRequests.length} new request(s)`);
  console.log();
  
  // Process each new request
  const results = [];
  for (const requestId of newRequests) {
    try {
      const result = await processRequest(requestId);
      results.push(result);
    } catch (error) {
      console.error(`Failed to process ${requestId}:`, error.message);
    }
  }
  
  console.log();
  console.log('='.repeat(60));
  console.log(`Summary: Processed ${results.length} request(s)`);
  console.log('='.repeat(60));
  
  // Exit with error if any requests failed
  if (results.length < newRequests.length) {
    process.exit(1);
  }
}

// Run the processor
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
