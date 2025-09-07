import * as core from '@actions/core';
import { execSync } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

interface CommitData {
  message: string;
  hash: string;
  shortHash: string;
  files: string;
  diff: string;
  branch: string;
}

interface APIResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

async function getCommitChanges(): Promise<CommitData | null> {
  try {
    core.info('🔍 Starting git commit data extraction...');
    
    // Get the latest commit changes
    core.info('📝 Extracting commit message...');
    const commitMessage = execSync('git log -1 --pretty=format:"%s"', { encoding: 'utf8' }).trim();
    core.info(`📝 Commit message: "${commitMessage}"`);
    
    core.info('🔗 Extracting commit hash...');
    const commitHash = execSync('git log -1 --pretty=format:"%H"', { encoding: 'utf8' }).trim();
    core.info(`🔗 Full commit hash: ${commitHash}`);
    
    core.info('📂 Extracting changed files...');
    const changedFiles = execSync('git show --name-status HEAD', { encoding: 'utf8' }).trim();
    core.info(`📂 Changed files:\n${changedFiles}`);
    
    core.info('📊 Extracting diff output...');
    const diffOutput = execSync('git show HEAD --pretty=format:"" --name-only', { encoding: 'utf8' }).trim();
    core.info(`📊 Diff output:\n${diffOutput}`);
    
    // Get repository and branch info
    core.info('🌿 Extracting branch information...');
    let branch = '';
    try {
      branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
      core.info(`🌿 Current branch (method 1): "${branch}"`);
    } catch (branchError) {
      core.warning(`⚠️ Method 1 failed, trying alternative: ${branchError instanceof Error ? branchError.message : String(branchError)}`);
      branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      core.info(`🌿 Current branch (method 2): "${branch}"`);
    }
    
    const commitData = {
      message: commitMessage,
      hash: commitHash,
      shortHash: commitHash.substring(0, 8),
      files: changedFiles,
      diff: diffOutput,
      branch: branch
    };
    
    core.info('✅ Successfully extracted all git commit data:');
    core.info(`   - Message: "${commitData.message}"`);
    core.info(`   - Hash: ${commitData.hash}`);
    core.info(`   - Short Hash: ${commitData.shortHash}`);
    core.info(`   - Branch: "${commitData.branch}"`);
    core.info(`   - Files changed: ${commitData.files.split('\n').length} files`);
    
    return commitData;
  } catch (error) {
    core.error(`❌ Failed to get git commit info: ${error instanceof Error ? error.message : String(error)}`);
    core.warning(`🔍 Error details: ${error instanceof Error ? error.stack : 'No stack trace available'}`);
    return null;
  }
}

async function generateSummary(commitData: CommitData, blackboxApiKey: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      core.info('🤖 Starting AI summary generation with BlackBox AI...');
      core.info(`🔧 Using model: ${model}`);
      core.info(`🔑 API key provided: ${blackboxApiKey ? `Yes (${blackboxApiKey.substring(0, 8)}...)` : 'No'}`);
      
      const prompt = `Analyze this git commit and provide a concise, professional summary focusing on:
- What changed (key functionality, files, features)
- Why the change was made (purpose, problem solved)
- Impact on users or system

Commit Details:
- Hash: ${commitData.shortHash}
- Message: ${commitData.message}
- Files: ${commitData.files}

Provide a clear, structured summary in 2-4 bullet points.`;

      core.info(`📝 Generated prompt (${prompt.length} chars):`);
      core.info(`${prompt.substring(0, 200)}...`);

      const requestPayload = {
        model: model,
        messages: [
          {
            role: "system",
            content: "You are a technical writer creating concise commit summaries for development teams."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      };

      const postData = JSON.stringify(requestPayload);
      core.info(`📦 Request payload size: ${Buffer.byteLength(postData)} bytes`);

      const options: https.RequestOptions = {
        hostname: 'api.blackbox.ai',
        port: 443,
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Authorization': `Bearer ${blackboxApiKey}`,
          'User-Agent': 'GitHub-Action-Summarizer/1.0'
        }
      };

      core.info(`🌐 Making request to: https://${options.hostname}${options.path}`);
      core.info(`📋 Request headers:`);
      Object.entries(options.headers || {}).forEach(([key, value]) => {
        if (key === 'Authorization') {
          core.info(`   ${key}: Bearer ${String(value).substring(7, 15)}...`);
        } else {
          core.info(`   ${key}: ${value}`);
        }
      });

      const req = https.request(options, (res) => {
        core.info(`📥 Response status: ${res.statusCode} ${res.statusMessage}`);
        core.info(`📋 Response headers:`);
        Object.entries(res.headers).forEach(([key, value]) => {
          core.info(`   ${key}: ${value}`);
        });

        let data = '';

        res.on('data', (chunk) => {
          const chunkStr = chunk.toString();
          core.info(`📥 Received chunk: ${chunkStr.length} bytes`);
          data += chunkStr;
        });

        res.on('end', () => {
          core.info(`📥 Response complete. Total size: ${data.length} bytes`);
          core.info(`📄 Raw response: ${data}`);
          
          try {
            const response = JSON.parse(data);
            core.info('✅ Successfully parsed JSON response');
            
            if (response.choices && response.choices[0] && response.choices[0].message) {
              const summary = response.choices[0].message.content.trim();
              core.info(`🎯 Extracted summary (${summary.length} chars): "${summary}"`);
              resolve(summary);
            } else {
              core.error('❌ Invalid response format from BlackBox AI');
              core.error(`🔍 Response structure: ${JSON.stringify(response, null, 2)}`);
              reject(new Error('Invalid response format from BlackBox AI'));
            }
          } catch (parseError) {
            core.error(`❌ Failed to parse BlackBox AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
            core.error(`🔍 Raw response that failed to parse: ${data}`);
            reject(new Error(`Failed to parse BlackBox AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
          }
        });
      });

      req.on('error', (error) => {
        core.error(`❌ Request error: ${error.message}`);
        core.error(`🔍 Error stack: ${error.stack}`);
        reject(error);
      });

      req.on('timeout', () => {
        core.error('⏰ BlackBox AI request timeout (30s)');
        req.destroy();
        reject(new Error('BlackBox AI request timeout'));
      });

      core.info('⏱️ Setting 30 second timeout...');
      req.setTimeout(30000);

      core.info('📤 Sending request...');
      req.write(postData);
      req.end();
      core.info('📤 Request sent successfully');
    } catch (error) {
      core.error(`❌ Error in generateSummary: ${error instanceof Error ? error.message : String(error)}`);
      core.error(`🔍 Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      reject(error);
    }
  });
}

async function sendToAPI(summary: string, apiUrl: string, commitData: CommitData | null): Promise<APIResponse> {
  return new Promise((resolve, reject) => {
    try {
      core.info('🚀 Starting API request to /generate-content endpoint...');
      core.info(`🌐 Target API URL: ${apiUrl}`);
      
      const url = new URL(apiUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      core.info(`🔒 Using ${isHttps ? 'HTTPS' : 'HTTP'} client`);
      core.info(`🏠 Hostname: ${url.hostname}`);
      core.info(`🚪 Port: ${url.port || (isHttps ? 443 : 80)}`);

      // Get repository name from environment or git remote
      core.info('📚 Determining repository information...');
      let repository = process.env.GITHUB_REPOSITORY || '';
      core.info(`📚 GITHUB_REPOSITORY env var: ${repository || 'Not set'}`);
      
      if (!repository) {
        core.info('📚 Attempting to get repository from git remote...');
        try {
          const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
          core.info(`📚 Git remote URL: ${remoteUrl}`);
          const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
          repository = match ? match[1] : 'unknown/repository';
          core.info(`📚 Extracted repository: ${repository}`);
        } catch (error) {
          core.warning(`⚠️ Failed to get git remote: ${error instanceof Error ? error.message : String(error)}`);
          repository = 'unknown/repository';
        }
      }

      const payload = {
        repository: repository,
        commit_sha: commitData?.hash || 'unknown',
        branch: commitData?.branch || process.env.GITHUB_REF_NAME || 'unknown',
        summary: summary,
        timestamp: new Date().toISOString()
      };

      core.info('📦 API payload:');
      core.info(`   - repository: "${payload.repository}"`);
      core.info(`   - commit_sha: "${payload.commit_sha}"`);
      core.info(`   - branch: "${payload.branch}"`);
      core.info(`   - summary: "${payload.summary.substring(0, 100)}..."`);
      core.info(`   - timestamp: "${payload.timestamp}"`);

      const postData = JSON.stringify(payload);
      core.info(`📦 Payload size: ${Buffer.byteLength(postData)} bytes`);

      // Ensure the path ends with /generate-content
      let path = url.pathname;
      core.info(`🛣️ Original path: ${path}`);
      if (!path.endsWith('/generate-content')) {
        path = path.replace(/\/$/, '') + '/generate-content';
        core.info(`🛣️ Modified path to: ${path}`);
      }
      path += url.search;
      core.info(`🛣️ Final path with search: ${path}`);

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'GitHub-Action-Send-Changes/1.0'
        }
      };

      core.info(`🌐 Making request to: ${isHttps ? 'https' : 'http'}://${options.hostname}:${options.port}${options.path}`);
      core.info(`📋 Request headers:`);
      Object.entries(options.headers || {}).forEach(([key, value]) => {
        core.info(`   ${key}: ${value}`);
      });

      const req = client.request(options, (res) => {
        core.info(`📥 Response received - Status: ${res.statusCode} ${res.statusMessage}`);
        core.info(`📋 Response headers:`);
        Object.entries(res.headers).forEach(([key, value]) => {
          core.info(`   ${key}: ${value}`);
        });

        let data = '';

        res.on('data', (chunk) => {
          const chunkStr = chunk.toString();
          core.info(`📥 Received chunk: ${chunkStr.length} bytes`);
          data += chunkStr;
        });

        res.on('end', () => {
          core.info(`📥 Response complete. Total size: ${data.length} bytes`);
          core.info(`📄 Response body: ${data}`);
          
          const apiResponse: APIResponse = {
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: data
          };
          
          core.info(`✅ API request completed with status ${apiResponse.statusCode}`);
          resolve(apiResponse);
        });
      });

      req.on('error', (error) => {
        core.error(`❌ API request error: ${error.message}`);
        core.error(`🔍 Error stack: ${error.stack}`);
        reject(error);
      });

      req.on('timeout', () => {
        core.error('⏰ API request timeout (30s)');
        req.destroy();
        reject(new Error('Request timeout'));
      });

      core.info('⏱️ Setting 30 second timeout...');
      req.setTimeout(30000); // 30 second timeout

      core.info('📤 Sending API request...');
      req.write(postData);
      req.end();
      core.info('📤 API request sent successfully');
    } catch (error) {
      core.error(`❌ Error in sendToAPI: ${error instanceof Error ? error.message : String(error)}`);
      core.error(`🔍 Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      reject(error);
    }
  });
}

async function run(): Promise<void> {
  try {
    core.info('🎬 === GitHub Action Started ===');
    core.info('📋 Reading input parameters...');
    
    // Get inputs
    const changes = core.getInput('changes');
    const blackboxApiKey = core.getInput('blackbox-api-key');
    const apiUrl = core.getInput('api-url');
    const model = core.getInput('model') || 'blackboxai';

    core.info('📋 Input parameters:');
    core.info(`   - changes: ${changes ? `"${changes.substring(0, 50)}..."` : 'Not provided'}`);
    core.info(`   - blackbox-api-key: ${blackboxApiKey ? `Provided (${blackboxApiKey.length} chars)` : 'Not provided'}`);
    core.info(`   - api-url: ${apiUrl || 'Not provided'}`);
    core.info(`   - model: ${model}`);

    core.info('🔍 Environment variables:');
    core.info(`   - GITHUB_REPOSITORY: ${process.env.GITHUB_REPOSITORY || 'Not set'}`);
    core.info(`   - GITHUB_REF_NAME: ${process.env.GITHUB_REF_NAME || 'Not set'}`);
    core.info(`   - GITHUB_SHA: ${process.env.GITHUB_SHA || 'Not set'}`);
    core.info(`   - GITHUB_WORKFLOW: ${process.env.GITHUB_WORKFLOW || 'Not set'}`);
    core.info(`   - GITHUB_ACTION: ${process.env.GITHUB_ACTION || 'Not set'}`);

    // Validate required inputs
    core.info('✅ Validating required inputs...');
    if (!blackboxApiKey) {
      throw new Error('BlackBox API key is required');
    }
    core.info('✅ BlackBox API key validation passed');
    
    // API URL is optional
    const hasApiConfig = !!apiUrl;
    core.info(`🌐 API configuration: ${hasApiConfig ? 'Configured' : 'Not configured'}`);
    if (!hasApiConfig) {
      core.info('⚠️ No API URL provided - summary will be generated but not sent to external API');
    }

    let commitData: CommitData | null = null;
    let summary = '';

    core.info('📝 Determining summary source...');
    // If changes are provided, use them; otherwise get from git
    if (changes) {
      core.info('📝 Using provided changes data as summary');
      core.info(`📝 Changes data length: ${changes.length} characters`);
      summary = changes;
    } else {
      core.info('📝 No changes provided, extracting from git...');
      commitData = await getCommitChanges();
      
      if (!commitData) {
        throw new Error('Could not retrieve commit data and no changes provided');
      }

      core.info(`📍 Found commit: ${commitData.shortHash} - ${commitData.message}`);
      
      // Generate AI summary
      core.info('🤖 Generating AI summary with BlackBox AI...');
      summary = await generateSummary(commitData, blackboxApiKey, model);
      core.info(`🎯 Generated summary (${summary.length} chars): ${summary}`);
    }

    // Set summary output
    core.info('📤 Setting action outputs...');
    core.setOutput('summary', summary);
    core.info(`✅ Summary output set: "${summary}"`);

    // Send summary to API only if API configuration is provided
    if (hasApiConfig) {
      core.info(`🚀 Sending summary to external API: ${apiUrl}`);
      const response = await sendToAPI(summary, apiUrl, commitData);

      // Set API-related outputs
      core.setOutput('response', response.body);
      core.setOutput('status', response.statusCode.toString());
      
      core.info('📤 API-related outputs set:');
      core.info(`   - response: "${response.body}"`);
      core.info(`   - status: "${response.statusCode}"`);

      // Log API results
      if (response.statusCode >= 200 && response.statusCode < 300) {
        core.info(`🎉 Successfully sent summary to API (Status: ${response.statusCode})`);
        core.info(`📄 API Response: ${response.body}`);
      } else {
        core.warning(`⚠️ API returned non-success status: ${response.statusCode}`);
        core.warning(`📄 API Response: ${response.body}`);
      }
    } else {
      // Set default outputs when no API is configured
      core.info('📤 Setting default outputs (no API configured)...');
      core.setOutput('response', 'No API configured - summary generated only');
      core.setOutput('status', '200');
      core.info('📝 Summary generated successfully (no API call made)');
    }

    core.info('🎉 === GitHub Action Completed Successfully ===');

  } catch (error) {
    core.error('💥 === GitHub Action Failed ===');
    core.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    core.error(`🔍 Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();