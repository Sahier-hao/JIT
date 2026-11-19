"""领域错误：带稳定 code，供 CLI 与 HTTP 层报告。

单独成模块以便 `schemas` 与 `data` 共用同一错误类型而不产生循环导入；
`data.BaselineError` 继续作为既有导入路径的再导出。
"""


class BaselineError(ValueError):
    """带稳定错误码的领域错误。"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
