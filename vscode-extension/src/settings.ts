import { existsSync } from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolvePython } from './python'

export { defaultInterpreter, defaultPython, resolvePython } from './python'

export const SETTINGS_SECTION = 'jitCommitAnalysis'

export interface CheckSettings {
  autoCheck: boolean
  backendPath: string
  pythonPath: string
  modelId: string
  databasePath: string
  artifactRoot: string
  riskThreshold: number
  showCandidates: boolean
}

export interface ResolvedSettings {
  autoCheck: boolean
  backend: string
  python: string
  pythonArgs: string[]
  modelId: string
  database: string
  artifacts: string
  riskThreshold: number
  showCandidates: boolean
}

export interface ResolvedEnvironment {
  backend: string
  python: string
  pythonArgs: string[]
  database: string
  artifacts: string
}

export interface ResolveResult {
  settings: ResolvedSettings | null
  issue: string | null
}

export interface EnvironmentResolveResult {
  environment: ResolvedEnvironment | null
  issue: string | null
}

export function readSettings(folder?: vscode.WorkspaceFolder): CheckSettings {
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION, folder?.uri)
  const threshold = config.get<number>('riskThreshold', 0.5)
  return {
    autoCheck: config.get<boolean>('autoCheck', true),
    backendPath: (config.get<string>('backendPath', '') ?? '').trim(),
    pythonPath: (config.get<string>('pythonPath', '') ?? '').trim(),
    modelId: (config.get<string>('modelId', '') ?? '').trim(),
    databasePath: (config.get<string>('databasePath', '') ?? '').trim(),
    artifactRoot: (config.get<string>('artifactRoot', '') ?? '').trim(),
    riskThreshold: Number.isFinite(threshold) ? Math.min(Math.max(threshold, 0), 1) : 0.5,
    showCandidates: config.get<boolean>('showCandidates', true),
  }
}

/** 选择模型前先解析后端、解释器、目录库和产物目录；不要求已有模型。 */
export function resolveEnvironment(folder: vscode.WorkspaceFolder,
                                   settings: CheckSettings): EnvironmentResolveResult {
  const backend = settings.backendPath || path.join(folder.uri.fsPath, 'backend')
  if (!existsSync(path.join(backend, 'jit_baseline'))) {
    return {
      environment: null,
      issue: `后端目录不可用：${backend}。被分析仓库不必包含 backend；把 jitCommitAnalysis.backendPath 指向 JIT 项目的 backend 即可。`,
    }
  }
  const python = resolvePython(backend, settings.pythonPath)
  if (!python) {
    return {
      environment: null,
      issue: '找不到可用的 Python 解释器，请设置 jitCommitAnalysis.pythonPath。',
    }
  }
  const database = settings.databasePath || path.join(backend, 'storage', 'catalog.sqlite3')
  if (!existsSync(database)) {
    return {
      environment: null,
      issue: `目录库不存在：${database}。请在「JIT: 配置提交后检查」里重新选择 JIT 项目的目录库。`,
    }
  }
  const artifacts = settings.artifactRoot || path.join(backend, 'artifacts')
  if (!existsSync(artifacts)) {
    return {
      environment: null,
      issue: `模型产物目录不存在：${artifacts}。请在配置里重新选择 JIT 项目的产物根目录。`,
    }
  }
  return {
    issue: null,
    environment: {
      backend,
      python: python.command,
      pythonArgs: python.args,
      database,
      artifacts,
    },
  }
}

/** 模型 ID、后端目录和解释器必须可用；其余路径按仓库结构推导。 */
export function resolveSettings(folder: vscode.WorkspaceFolder,
                                settings: CheckSettings): ResolveResult {
  if (!settings.modelId) {
    return { settings: null, issue: 'JIT 提交检查还需要配置模型 ID。' }
  }
  const resolved = resolveEnvironment(folder, settings)
  if (!resolved.environment) {
    return { settings: null, issue: resolved.issue }
  }
  return {
    issue: null,
    settings: {
      autoCheck: settings.autoCheck,
      backend: resolved.environment.backend,
      python: resolved.environment.python,
      pythonArgs: resolved.environment.pythonArgs,
      modelId: settings.modelId,
      database: resolved.environment.database,
      artifacts: resolved.environment.artifacts,
      riskThreshold: settings.riskThreshold,
      showCandidates: settings.showCandidates,
    },
  }
}
