/**
 * polaris-exec: bounded subprocess execution + runtime behavior monitoring.
 */

import { runExec } from '../lib/exec.js'
import { registerPrimitive, tokenize } from './helper.js'

export const name = 'polaris-exec'
export const inject = ['commands', 'skills']

const SKILL = `# 北极星有界执行原语 (polaris-exec)

在硬超时、输出上限与精简环境下执行一条命令，并报告退出码、信号、墙钟时间与截断状态。

用法：
\`\`\`
/polaris-exec "python -c 'print(1)'" --cwd /path --timeout 30000 --maxOutput 65536
\`\`\`

这是有界执行监控原语，不是安全沙箱；真正 OS 级隔离由 DSH 沙箱栈负责。`

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-exec',
    description: '有界子进程执行与运行时行为监控（超时、输出上限、退出码、墙钟时间）',
    hint: '"<command>" [--cwd path] [--timeout 30000] [--maxOutput 65536] [--clean-env]',
    skill: SKILL,
    handler: async invocation => ({ kind: 'success', text: runExec(tokenize(invocation.rawInput)) }),
  })
}
