/**
 * 验证证据的运行工作区与归档约定。
 *
 * 见 `openspec/changes/separate-run-evidence-from-archive/design.md` 的 D1/D2：
 * 测试与验证的输出写入可覆盖、不提交的运行工作区；归档证据只由显式冻结产生，
 * 测试不写任何已归档 change 的证据目录。前端侧只在本模块定义这些路径。
 *
 * 路径相对前端根目录解析，与 npm 脚本的工作目录一致。本模块只被配置文件与
 * e2e 检查导入，不进入应用构建。
 */
import { mkdirSync } from 'node:fs'

/** 运行工作区：测试与验证输出写这里，可被后续运行覆盖，不进入版本控制。 */
export const runEvidenceDir = '../docs/evidence/_run'

/** 运行工作区内的截图目录。 */
export const runScreenshotDir = `${runEvidenceDir}/screenshots`

/** 运行期夹具目录：跨测试或跨语言交接用，冻结时排除。 */
export const runFixtureDir = `${runEvidenceDir}/fixtures`

/** 确保目录存在并返回其路径，供运行前准备工作区使用。 */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}
