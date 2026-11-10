## ADDED Requirements

### Requirement: UAC-01 普通用户账户

系统 SHALL 允许在本机注册普通用户账户，用户名唯一、密码以独立盐的 PBKDF2 哈希保存。密码 MUST 为 8–256 位；重复用户名、错误密码和频繁尝试 MUST 被明确拒绝。管理员账户与普通用户账户 MUST 独立，不得互相代替。

#### Scenario: 注册并登录
- **WHEN** 用户提交未占用的用户名和合规密码
- **THEN** 创建账户并建立 8 小时会话，后续用户接口可识别其身份

#### Scenario: 重复用户名
- **WHEN** 注册已存在的用户名
- **THEN** 拒绝注册并说明账户已存在

#### Scenario: 登录失败
- **WHEN** 密码错误或短时间多次尝试
- **THEN** 返回统一失败信息；超过阈值时要求稍后重试

### Requirement: UAC-02 会话与退出

用户会话 MUST 使用 HttpOnly、SameSite=Strict cookie，8 小时过期；退出 MUST 立即撤销当前会话。会话过期或被撤销后，用户接口 MUST 返回未登录，MUST NOT 以其他用户或管理员身份继续。

#### Scenario: 退出后访问
- **WHEN** 用户退出后再次请求用户数据
- **THEN** 返回未登录，不返回任何用户数据

#### Scenario: 管理员与用户并存
- **WHEN** 同一浏览器同时存在管理员会话和用户会话
- **THEN** 管理接口只按管理员身份，用户接口只按用户身份，互不冒充
