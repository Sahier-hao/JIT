# Design

## Context

- schema 身份指纹是"运行身份"的一部分：登记模型时把 `featureSchema`（含 `schemaSha256`）写进 `model_version.payload`，之后每次产物校验都把当前计算出的指纹与 payload 里的比对，不一致即判 `ARTIFACT_INVALID` 并把模型降级为不可用。
- 指纹的实现是 `identity(asdict(schema))`：把 dataclass 递归转成有序映射后取哈希。因此**任何字段增删或默认值变化都会改变指纹**，包括新增但从未启用的可选字段。
- 现状由 `cc528ed` 触发：`Schema` 新增 `semantic=None`、`semantic_only=False`，`openstack-six-v1` 的指纹从 `259ee768…` 变为 `d136eaa…`，已登记的逻辑回归模型被降级，随后每次仓库分析都在训练阶段以 `MODEL_NOT_READY` 结束。
- 语义扩展是真实存在的另一条路径：`kamei14-semantic-codebert-v1` 会声明具体扩展内容，它的指纹必须与同名非语义声明不同。

## Goals / Non-Goals

**Goals:**

- 让"实现新增未使用的默认字段"不改变既有运行的指纹。
- 保留"声明被篡改必须失败"与"启用扩展必须改变指纹"两条既有保证。

**Non-Goals:**

- 不改变指纹算法本身（仍是 `identity`），不改产物格式、不重训模型。
- 不为历史 payload 做批量回填：重新登记一次即可恢复，旧 payload 保持原样可追溯。

## Decisions

**1. 在计算指纹前剔除"未启用的扩展声明"，而不是给 `Schema` 加版本号。**

- 新增 `_identity_claims(schema)`：当 `semantic is None` 且 `semantic_only is False` 时，从 `asdict` 结果里删掉这两个键再交给 `identity()`。
- 替代方案 A：把两个字段标成 `init=False`/`compare=False`——但 `asdict` 不看 `compare`，仍然会出现在映射里，解决不了问题。
- 替代方案 B：把 `schemaSha256` 从身份里去掉——会让"声明被篡改"不再被发现，等于拆掉校验。
- 替代方案 C：为每个 schema 手写白名单字段——可行但把声明硬编码进代码，后续新增 schema 需要改代码。

**2. 只剔除"未启用"的扩展，而不是无条件忽略所有扩展键。**

- 条件写成"值为默认"而非"键名匹配"，这样声明了具体扩展内容的 schema 仍保留原键，指纹与未声明版本不同；测试里用 `kamei14-semantic-codebert-v1 != kamei14-git-v1` 锁住这条边界。

**3. 用重新登记恢复，而不是改库。**

- `register()` 已实现"同一产物 → `created: false`，把 state 置回 ready 并重写 payload"，因此修复后跑一次 `register-model --run-key <名称>` 即可；手工改库会绕过准入检查。

## Risks / Trade-offs

- [剔除键可能掩盖真实差异] 如果将来某个 schema 把语义字段当必填，剔除逻辑会误判 → 条件严格限定在"值为 None/False"，并由"启用扩展必须改变指纹"的场景测试守住。
- [已降级的模型需要人工恢复] 修复代码不会自动把 `state` 改回 ready → 在 tasks 里写明重新登记的命令与预期输出（`created: false`、`state=ready`）。
- [历史 payload 与新指纹的关系] 旧 payload 存的是旧算法结果，修复后重算必须与它一致 → 回归测试断言 `openstack-six-v1` 的指纹恒为 `259ee768…`，正是登记时写入的值。
