import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { complete } from '../../providers/index.js';
import { formatCost, getModelInfo } from '../../providers/router.js';
import { ModelId, MODELS } from '../../providers/types.js';
import { gatherContext, formatContextForPrompt } from '../../context/gather.js';
import { config } from '../../utils/config.js';

interface CompareOptions {
  models: string;
}

interface ModelResult {
  model: ModelId;
  content: string;
  tokens: number;
  cost: number;
  latency: number;
  error?: string;
}

export async function compareModels(prompt: string, options: CompareOptions): Promise<void> {
  const modelList = options.models.split(',').map(m => m.trim());
  
  // Map short names to IDs
  const modelMap: Record<string, ModelId> = {
    'deepseek': 'deepseek-v3',
    'sonnet': 'claude-sonnet-4',
    'opus': 'claude-opus-4',
    'gemini': 'gemini-2-pro',
    'gpt4': 'gpt-4o',
  };

  const modelIds: ModelId[] = modelList.map(m => 
    (modelMap[m.toLowerCase()] || m) as ModelId
  ).filter(m => MODELS[m]);

  if (modelIds.length === 0) {
    console.error(chalk.red('No valid models specified'));
    console.log(chalk.dim('Available: deepseek, sonnet, opus, gemini, gpt4'));
    process.exit(1);
  }

  console.log(chalk.bold(`\nComparing ${modelIds.length} models on: "${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}"\n`));

  // Gather context
  const cwd = process.cwd();
  let contextStr = '';
  
  const contextSpinner = ora('Gathering context...').start();
  try {
    const context = await gatherContext(cwd, { maxTokens: 50000 });
    contextStr = formatContextForPrompt(context);
    contextSpinner.succeed(`Context: ${context.files.length} files`);
  } catch {
    contextSpinner.warn('No context gathered');
  }

  // Build messages
  const messages = [
    { role: 'system' as const, content: 'You are an expert software engineer. Be concise.' },
  ];

  if (contextStr) {
    messages.push({ role: 'user' as const, content: contextStr });
    messages.push({ role: 'assistant' as const, content: 'I\'ve reviewed the context.' });
  }

  messages.push({ role: 'user' as const, content: prompt });

  // Run on each model
  const results: ModelResult[] = [];

  for (const modelId of modelIds) {
    const modelInfo = getModelInfo(modelId);
    const spinner = ora(`Running on ${modelInfo.name}...`).start();

    try {
      const response = await complete({ model: modelId, messages });
      
      results.push({
        model: modelId,
        content: response.content,
        tokens: response.usage.totalTokens,
        cost: response.cost.total,
        latency: response.latency,
      });

      spinner.succeed(`${modelInfo.name}: ${response.usage.totalTokens} tokens, ${formatCost(response.cost.total)}`);
    } catch (error) {
      results.push({
        model: modelId,
        content: '',
        tokens: 0,
        cost: 0,
        latency: 0,
        error: (error as Error).message,
      });
      spinner.fail(`${modelInfo.name}: ${(error as Error).message}`);
    }
  }

  // Summary table
  console.log('\n' + chalk.bold('Comparison Summary'));
  
  const table = new Table({
    head: [
      chalk.cyan('Model'),
      chalk.cyan('Tokens'),
      chalk.cyan('Cost'),
      chalk.cyan('Latency'),
      chalk.cyan('Status'),
    ],
    style: { head: [], border: [] },
  });

  // Sort by cost
  results.sort((a, b) => a.cost - b.cost);

  const cheapest = results[0]?.cost || 0;
  const mostExpensive = results[results.length - 1]?.cost || 0;

  for (const result of results) {
    const modelInfo = MODELS[result.model];
    const savings = mostExpensive > 0 
      ? `${Math.round((1 - result.cost / mostExpensive) * 100)}% cheaper`
      : '';

    table.push([
      modelInfo.name,
      result.tokens.toLocaleString(),
      formatCost(result.cost),
      `${(result.latency / 1000).toFixed(2)}s`,
      result.error 
        ? chalk.red('Failed') 
        : result.cost === cheapest 
          ? chalk.green('✓ Cheapest')
          : chalk.dim(savings),
    ]);
  }

  console.log(table.toString());

  // Show responses
  console.log('\n' + chalk.bold('Responses'));
  
  for (const result of results) {
    if (result.error) continue;
    
    const modelInfo = MODELS[result.model];
    console.log(chalk.cyan(`\n─── ${modelInfo.name} ───`));
    console.log(result.content.slice(0, 500) + (result.content.length > 500 ? '...' : ''));
  }

  // Savings summary
  if (results.length > 1 && cheapest < mostExpensive) {
    const savings = mostExpensive - cheapest;
    const savingsPercent = Math.round((savings / mostExpensive) * 100);
    console.log(chalk.green(`\n💰 Potential savings: ${formatCost(savings)} (${savingsPercent}%) using ${MODELS[results[0].model].name}`));
  }
}
