/**
 * polaris-exec: bounded subprocess execution + runtime behavior monitoring.
 */

import { runExec } from '../lib/exec.js'
import { registerPrimitive, textTool, tokenize } from './helper.js'

export const name = 'polaris-exec'
export const inject = ['commands', 'skills', 'tools']

const SKILL = `# 北极星有界执行原语 (polaris-exec)

在硬超时、输出上限与精简环境下执行一条命令，并报告退出码、信号、墙钟时间与截断状态。

模型工具：\`polaris_exec\`。需要一次有界冒烟执行时自动调用。

人工命令：\`/polaris-exec "python -c 'print(1)'" --cwd /path --timeout 30000 --maxOutput 65536\`

这是有界执行监控原语，不是安全沙箱；真正 OS 级隔离由 DSH 沙箱栈负责。`

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-exec',
    description: '有界子进程执行与运行时行为监控（超时、输出上限、退出码、墙钟时间）',
    hint: '"<command>" [--cwd path] [--timeout 30000] [--maxOutput 65536] [--clean-env]',
    skill: SKILL,
    handler: async invocation => ({ kind: 'success', text: runExec(tokenize(invocation.rawInput)) }),
    tool: textTool('polaris_exec', 'Run a shell command with a hard timeout and output cap, and report exit code, wall time, and truncation. Use for bounded smoke execution during development.', {
      command: { type: 'string', description: 'Shell command to execute.' },
      cwd: { type: 'string', description: 'Working directory.' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000).' },
      maxOutput: { type: 'number', description: 'Output cap in bytes (default 65536).' },
    }, async args => {
      if (!args.command) throw new Error('command is required')
      return { report: runExec([args.command, '--cwd', args.cwd ?? process.cwd(), '--timeout', String(args.timeout ?? 30000), '--maxOutput', String(args.maxOutput ?? 65536)]) }
    }),
  })
}
