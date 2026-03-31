import chalk from 'chalk';
import open from 'open';
import ora from 'ora';
import { config } from '../../utils/config.js';
import boxen from 'boxen';

const AUTH_URL = 'https://axon.dev/auth/cli';
const POLL_INTERVAL = 2000; // 2 seconds
const POLL_TIMEOUT = 120000; // 2 minutes

export async function login(): Promise<void> {
  if (config.isAuthenticated()) {
    const email = config.get('email');
    console.log(chalk.yellow(`Already logged in as ${email}`));
    console.log(chalk.dim('Run `axon logout` to switch accounts'));
    return;
  }

  // Generate a device code
  const deviceCode = generateDeviceCode();
  const authUrl = `${AUTH_URL}?code=${deviceCode}`;

  console.log(boxen(
    `${chalk.bold('Login to Axon')}\n\n` +
    `Opening browser to complete authentication...\n\n` +
    `If browser doesn't open, visit:\n` +
    chalk.cyan(authUrl) + '\n\n' +
    `Device code: ${chalk.bold(deviceCode)}`,
    { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
  ));

  // Open browser
  await open(authUrl);

  // Poll for completion
  const spinner = ora('Waiting for authentication...').start();
  
  try {
    const result = await pollForAuth(deviceCode);
    spinner.succeed('Authentication successful!');
    
    // Save credentials
    config.setAll({
      apiKey: result.apiKey,
      userId: result.userId,
      email: result.email,
      orgId: result.orgId,
    });

    console.log(chalk.green(`\n✓ Logged in as ${result.email}`));
    if (result.orgId) {
      console.log(chalk.dim(`  Organization: ${result.orgName || result.orgId}`));
    }
  } catch (error) {
    spinner.fail('Authentication failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

export async function logout(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('Not currently logged in'));
    return;
  }

  const email = config.get('email');
  config.clear();
  console.log(chalk.green(`✓ Logged out from ${email}`));
}

export async function whoami(): Promise<void> {
  if (!config.isAuthenticated()) {
    console.log(chalk.yellow('Not logged in'));
    console.log(chalk.dim('Run `axon login` to authenticate'));
    return;
  }

  const email = config.get('email');
  const orgId = config.get('orgId');
  const configPath = config.getConfigPath();

  console.log(boxen(
    `${chalk.bold('Current User')}\n\n` +
    `Email: ${chalk.cyan(email)}\n` +
    `Organization: ${orgId || chalk.dim('Personal')}\n` +
    `Config: ${chalk.dim(configPath)}`,
    { padding: 1, borderColor: 'green', borderStyle: 'round' }
  ));
}

// Helper functions

function generateDeviceCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

interface AuthResult {
  apiKey: string;
  userId: string;
  email: string;
  orgId?: string;
  orgName?: string;
}

async function pollForAuth(deviceCode: string): Promise<AuthResult> {
  const startTime = Date.now();
  const apiBaseUrl = config.get('apiBaseUrl') || 'https://api.axon.dev';

  while (Date.now() - startTime < POLL_TIMEOUT) {
    try {
      const response = await fetch(`${apiBaseUrl}/auth/device/${deviceCode}`);
      
      if (response.status === 200) {
        const data = await response.json() as AuthResult;
        return data;
      }
      
      if (response.status === 404) {
        // Not yet authenticated, continue polling
        await sleep(POLL_INTERVAL);
        continue;
      }

      if (response.status === 410) {
        throw new Error('Device code expired. Please try again.');
      }

      throw new Error(`Unexpected response: ${response.status}`);
    } catch (error) {
      if ((error as Error).message.includes('fetch')) {
        // Network error, continue polling
        await sleep(POLL_INTERVAL);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Authentication timed out. Please try again.');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
