import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { complete } from '../../providers/index.js';
import { selectModel, formatCost, getModelInfo, compareCosts } from '../../providers/router.js';
import { ModelId, MODELS } from '../../providers/types.js';
import { gatherContext, formatContextForPrompt, getContextSummary } from '../../context/gather.js';
import { config } from '../../utils/config.js';

interface RunOptions {
  model: string;
  compare: boolean;
  context: boolean;
  verbose: boolean;
}

export async function runPrompt(prompt: string, options: RunOptions): Promise<void> {
  // Check auth
  if (!config.isAuthenticated()) {
    // Check for BYOK
    const providers = config.get('providers');
    const hasAnyKey = providers && Object.values(providers).some(k => !!k);
    
    if (!hasAnyKey) {
      console.log(chalk.yellow('Not authenticated.'));
      console.log(chalk.dim('Run `axon login` or configure provider keys with `axon config:set providers.<provider> <key>`'));
      process.exit(1);
    }
  }

  const cwd = process.cwd();

  // Gather context if enabled
  let contextStr = '';
  let contextSummary = '';
  
  if (options.context !== false) {
    const spinner = ora('Gathering context...').start();
    try {
      const context = await gatherContext(cwd, {
        maxTokens: config.get('maxContextTokens') || 100000,
      });
      contextStr = formatContextForPrompt(context);
      contextSummary = getContextSummary(context);
      spinner.succeed(`Context: ${contextSummary}`);
    } catch (error) {
      spinner.warn('Could not gather context');
      if (options.verbose) {
        console.log(chalk.dim((error as Error).message));
      }
    }
  }

  // Select model
  let modelId: ModelId;
  
  if (options.model === 'auto') {
    modelId = selectModel(prompt, {
      contextSize: contextStr.length / 4, // rough token estimate
    });
    console.log(chalk.dim(`Auto-selected: ${MODELS[modelId].name}`));
  } else {
    // Map short names to full model IDs
    const modelMap: Record<string, ModelId> = {
      'deepseek': 'deepseek-v3',
      'sonnet': 'claude-sonnet-4',
      'opus': 'claude-opus-4',
      'gemini': 'gemini-2-pro',
    };
    
    modelId = (modelMap[options.model] || options.model) as ModelId;
    
    if (!MODELS[modelId]) {
      console.error(chalk.red(`Unknown model: ${options.model}`));
      console.log(chalk.dim('Available: deepseek, sonnet, opus, gemini'));
      process.exit(1);
    }
  }

  const modelInfo = getModelInfo(modelId);

  // Build messages
  const systemPrompt = `You are an expert software engineer. You help with coding tasks efficiently and accurately.
When modifying code, show the changes clearly. Be concise but thorough.`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
  ];

  if (contextStr) {
    messages.push({
      role: 'user' as const,
      content: `Here is the current codebase context:\n\n${contextStr}`,
    });
    messages.push({
      role: 'assistant' as const,
      content: 'I\'ve reviewed the codebase context. How can I help you?',
    });
  }

  messages.push({
    role: 'user' as const,
    content: prompt,
  });

  // Execute
  const spinner = ora(`Thinking with ${modelInfo.name}...`).start();
  const startTime = Date.now();

  try {
    const response = await complete({
      model: modelId,
      messages,
    });

    spinner.stop();

    // Output response
    console.log('\n' + response.content + '\n');

    // Show metadata
    if (options.verbose) {
      const latencySeconds = (response.latency / 1000).toFixed(2);
      
      console.log(boxen(
        `${chalk.bold('Response Stats')}\n\n` +
        `Model: ${modelInfo.name}\n` +
        `Tokens: ${response.usage.inputTokens.toLocaleString()} in / ${response.usage.outputTokens.toLocaleString()} out\n` +
        `Cost: ${formatCost(response.cost.total)}\n` +
        `Latency: ${latencySeconds}s`,
        { padding: 1, borderColor: 'gray', borderStyle: 'round', dimBorder: true }
      ));

      // Show cost comparison
      if (response.usage.totalTokens > 0) {
        console.log(chalk.dim('\nCost comparison for this request:'));
        const comparison = compareCosts(response.usage.inputTokens, response.usage.outputTokens);
        for (const item of comparison.slice(0, 4)) {
          const model = MODELS[item.model];
          const marker = item.model === modelId ? chalk.green('→') : ' ';
          console.log(chalk.dim(`  ${marker} ${model.name}: ${formatCost(item.cost)} ${item.savings}`));
        }
      }
    } else {
      // Brief stats line
      const costStr = formatCost(response.cost.total);
      console.log(chalk.dim(`${modelInfo.name} • ${response.usage.totalTokens.toLocaleString()} tokens • ${costStr}`));
    }

  } catch (error) {
    spinner.fail('Request failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}
