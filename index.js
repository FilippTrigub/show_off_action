const core = require('@actions/core');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const { URL } = require('url');

async function getCommitChanges() {
  try {
    // Get the latest commit changes
    const commitMessage = execSync('git log -1 --pretty=format:"%s"', { encoding: 'utf8' }).trim();
    const commitHash = execSync('git log -1 --pretty=format:"%H"', { encoding: 'utf8' }).trim();
    const changedFiles = execSync('git show --name-status HEAD', { encoding: 'utf8' }).trim();
    const diffOutput = execSync('git show HEAD --pretty=format:"" --name-only', { encoding: 'utf8' }).trim();
    
    // Get repository and branch info
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim() || 
                   execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    
    return {
      message: commitMessage,
      hash: commitHash,
      shortHash: commitHash.substring(0, 8),
      files: changedFiles,
      diff: diffOutput,
      branch: branch
    };
  } catch (error) {
    core.warning(`Could not get git commit info: ${error.message}`);
    return null;
  }
}

async function generateSummary(commitData, blackboxApiKey, model) {
  return new Promise((resolve, reject) => {
    try {
      const prompt = `Analyze this git commit and provide a concise, professional summary focusing on:
- What changed (key functionality, files, features)
- Why the change was made (purpose, problem solved)
- Impact on users or system

Commit Details:
- Hash: ${commitData.shortHash}
- Message: ${commitData.message}
- Files: ${commitData.files}

Provide a clear, structured summary in 2-4 bullet points.`;

      const postData = JSON.stringify({
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
      });

      const options = {
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

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.choices && response.choices[0] && response.choices[0].message) {
              resolve(response.choices[0].message.content.trim());
            } else {
              reject(new Error('Invalid response format from BlackBox AI'));
            }
          } catch (parseError) {
            reject(new Error(`Failed to parse BlackBox AI response: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('BlackBox AI request timeout'));
      });

      req.setTimeout(30000);

      req.write(postData);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function sendToAPI(summary, apiKey, apiUrl, commitData) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(apiUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      // Get repository name from environment or git remote
      let repository = process.env.GITHUB_REPOSITORY || '';
      if (!repository) {
        try {
          const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
          const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
          repository = match ? match[1] : 'unknown/repository';
        } catch (error) {
          repository = 'unknown/repository';
        }
      }

      const postData = JSON.stringify({
        summary: summary,
        repository: repository,
        commit_sha: commitData?.hash || 'unknown',
        branch: commitData?.branch || process.env.GITHUB_REF_NAME || 'unknown',
        timestamp: new Date().toISOString()
      });

      // Ensure the path ends with /generate-content
      let path = url.pathname;
      if (!path.endsWith('/generate-content')) {
        path = path.replace(/\/$/, '') + '/generate-content';
      }
      path += url.search;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'GitHub-Action-Send-Changes/1.0'
        }
      };

      const req = client.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.setTimeout(30000); // 30 second timeout

      req.write(postData);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function run() {
  try {
    // Get inputs
    const changes = core.getInput('changes');
    const blackboxApiKey = core.getInput('blackbox-api-key');
    const apiKey = core.getInput('api-key');
    const apiUrl = core.getInput('api-url');
    const model = core.getInput('model') || 'blackboxai';

    // Validate required inputs
    if (!blackboxApiKey) {
      throw new Error('BlackBox API key is required');
    }
    
    // API key and URL are now optional
    const hasApiConfig = apiKey && apiUrl;
    if (!hasApiConfig) {
      core.info('⚠️ No API configuration provided - summary will be generated but not sent to external API');
    }

    let commitData = null;
    let summary = '';

    // If changes are provided, use them; otherwise get from git
    if (changes) {
      core.info('Using provided changes data');
      summary = changes;
    } else {
      core.info('Getting commit changes from git...');
      commitData = await getCommitChanges();
      
      if (!commitData) {
        throw new Error('Could not retrieve commit data and no changes provided');
      }

      core.info(`Found commit: ${commitData.shortHash} - ${commitData.message}`);
      
      // Generate AI summary
      core.info('Generating AI summary with BlackBox AI...');
      summary = await generateSummary(commitData, blackboxApiKey, model);
      core.info(`Generated summary: ${summary}`);
    }

    // Set summary output
    core.setOutput('summary', summary);
    core.info(`✅ Generated summary: ${summary}`);

    // Send summary to API only if API configuration is provided
    if (hasApiConfig) {
      core.info(`Sending summary to API: ${apiUrl}`);
      const response = await sendToAPI(summary, apiKey, apiUrl, commitData);

      // Set API-related outputs
      core.setOutput('response', response.body);
      core.setOutput('status', response.statusCode.toString());

      // Log API results
      if (response.statusCode >= 200 && response.statusCode < 300) {
        core.info(`✅ Successfully sent summary to API (Status: ${response.statusCode})`);
        core.info(`Response: ${response.body}`);
      } else {
        core.warning(`⚠️ API returned non-success status: ${response.statusCode}`);
        core.warning(`Response: ${response.body}`);
      }
    } else {
      // Set default outputs when no API is configured
      core.setOutput('response', 'No API configured - summary generated only');
      core.setOutput('status', '200');
      core.info('📝 Summary generated successfully (no API call made)');
    }

  } catch (error) {
    core.error(`❌ Error: ${error.message}`);
    core.setFailed(error.message);
  }
}

run();