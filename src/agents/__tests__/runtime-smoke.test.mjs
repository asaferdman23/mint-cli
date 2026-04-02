import { build } from 'esbuild';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strict as assert } from 'node:assert';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const tempBundleDir = mkdtempSync(path.join(tmpdir(), 'mint-runtime-bundle-'));
  const runtimeBundle = path.join(tempBundleDir, 'runtime-bundle.mjs');
  const schedulerBundle = path.join(tempBundleDir, 'scheduler-bundle.mjs');
  const toolsBundle = path.join(tempBundleDir, 'tools-bundle.mjs');
  const workspace = mkdtempSync(path.join(tmpdir(), 'mint-runtime-workspace-'));

  try {
    await build({
      entryPoints: [path.join(root, 'src/agents/runtime.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: runtimeBundle,
      logLevel: 'silent',
    });

    await build({
      entryPoints: [path.join(root, 'src/agents/scheduler.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: schedulerBundle,
      logLevel: 'silent',
    });

    await build({
      entryPoints: [path.join(root, 'src/tools/index.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: toolsBundle,
      logLevel: 'silent',
    });

    const {
      createInitialSubtasks,
      createOrchestrationRuntime,
      runTaskGraph,
    } = await import(pathToFileURL(runtimeBundle).href);
    const { validateTaskGraph } = await import(pathToFileURL(schedulerBundle).href);
    const {
      getAllowedToolNamesForRole,
      isConcurrencySafeTool,
      toolRequiresApproval,
    } = await import(pathToFileURL(toolsBundle).href);

    const runtime = await createOrchestrationRuntime(workspace, 'runtime smoke');
    runtime.maxConcurrency = 3;

    const marks = new Map();
    const tasks = [
      {
        id: '1',
        phase: 'BUILDER',
        role: 'builder',
        title: 'Task 1',
        description: 'Write shared file',
        writeTargets: ['src/shared.ts'],
        run: async (reporter) => {
          marks.set('1-start', Date.now());
          await reporter.progress('writing shared file');
          await reporter.log('inspecting shared file');
          await wait(40);
          marks.set('1-end', Date.now());
          return { value: 'one', summary: 'done one', duration: 40, cost: 0.01 };
        },
      },
      {
        id: '2',
        phase: 'BUILDER',
        role: 'builder',
        title: 'Task 2',
        description: 'Depends on task 1',
        dependsOn: ['1'],
        writeTargets: ['src/feature.ts'],
        run: async () => {
          marks.set('2-start', Date.now());
          await wait(10);
          marks.set('2-end', Date.now());
          return { value: 'two', summary: 'done two', duration: 10, cost: 0.01 };
        },
      },
      {
        id: '3',
        phase: 'BUILDER',
        role: 'builder',
        title: 'Task 3',
        description: 'Conflicts with task 1 writes',
        writeTargets: ['src/shared.ts'],
        run: async () => {
          marks.set('3-start', Date.now());
          await wait(10);
          marks.set('3-end', Date.now());
          return { value: 'three', summary: 'done three', duration: 10, cost: 0.01 };
        },
      },
    ];

    const initial = createInitialSubtasks(tasks);
    assert.equal(initial[0].status, 'queued');
    assert.equal(initial[1].status, 'blocked');
    assert.equal(initial[2].status, 'queued');

    const iterator = runTaskGraph(runtime, tasks, {});
    const events = [];
    let finalStates;
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        finalStates = next.value;
        break;
      }
      events.push(next.value);
    }

    assert.ok(events.some((event) => event.type === 'task-start' && event.task?.taskId === '1'));
    assert.ok(events.some((event) => event.type === 'task-progress' && event.task?.taskId === '1' && event.task?.progressSummary === 'writing shared file'));
    assert.ok(events.some((event) => event.type === 'task-log' && event.task?.taskId === '1' && String(event.log).includes('inspecting shared file')));
    assert.ok(events.some((event) => event.type === 'task-progress' && event.task?.taskId === '2'));
    assert.ok(events.some((event) => event.type === 'task-done' && event.task?.taskId === '3'));
    assert.ok(events.some((event) => event.type === 'task-log' && String(event.log).includes('Serialized #3')), 'write conflict warning should be emitted');
    assert.ok(marks.get('3-start') >= marks.get('1-end'), 'conflicting writes should serialize');
    assert.ok(marks.get('2-start') >= marks.get('1-end'), 'dependency should start after prerequisite completes');

    const failedRuntime = await createOrchestrationRuntime(workspace, 'failure smoke');
    failedRuntime.maxConcurrency = 2;
    const failedIterator = runTaskGraph(failedRuntime, [
      {
        id: 'A',
        phase: 'BUILDER',
        role: 'builder',
        title: 'Task A',
        description: 'Failing prerequisite',
        writeTargets: ['src/a.ts'],
        run: async () => {
          throw new Error('boom');
        },
      },
      {
        id: 'B',
        phase: 'BUILDER',
        role: 'builder',
        title: 'Task B',
        description: 'Blocked by A',
        dependsOn: ['A'],
        writeTargets: ['src/b.ts'],
        run: async () => ({ value: 'should-not-run' }),
      },
    ], {});

    let failedStates;
    while (true) {
      const next = await failedIterator.next();
      if (next.done) {
        failedStates = next.value;
        break;
      }
    }

    const blockedState = failedStates.find((state) => state.id === 'B');
    assert.equal(blockedState.status, 'failed');
    assert.ok(String(blockedState.progressSummary).includes('blocked by failed dependency'));

    assert.throws(() => validateTaskGraph([
      { taskId: 'x', dependsOn: ['y'] },
      { taskId: 'y', dependsOn: ['x'] },
    ]), /cycle/i);

    assert.ok(existsSync(path.join(runtime.baseDir, 'meta.json')), 'run meta should exist');
    assert.ok(existsSync(path.join(runtime.baseDir, 'parent.jsonl')), 'parent log should exist');
    assert.ok(existsSync(path.join(runtime.baseDir, 'builder-1.jsonl')), 'root task transcript should exist');
    assert.ok(existsSync(path.join(runtime.tasksDir, '1.meta.json')), 'task meta should exist');
    assert.ok(existsSync(path.join(runtime.tasksDir, '1.jsonl')), 'task event log should exist');
    assert.ok(readFileSync(path.join(runtime.baseDir, 'parent.jsonl'), 'utf8').includes('"task-start"'));

    assert.ok(getAllowedToolNamesForRole('builder').includes('search_replace'));
    assert.ok(!getAllowedToolNamesForRole('reviewer').includes('edit_file'));
    assert.equal(isConcurrencySafeTool('read_file'), true);
    assert.equal(isConcurrencySafeTool('bash'), false);
    assert.equal(toolRequiresApproval('git_diff', {}), false);
    assert.equal(toolRequiresApproval('search_replace', { path: 'x', search: 'a', replace: 'b' }), true);
    assert.equal(toolRequiresApproval('bash', { command: 'npm test' }), false);
    assert.equal(toolRequiresApproval('bash', { command: 'rm -rf tmp' }), true);

    console.log('Runtime orchestration smoke passed.');
  } finally {
    rmSync(tempBundleDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
