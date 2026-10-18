# 四种深度方法的训练记录（任务 7.1）

本机具备 `torch 2.14.1+cpu`（CPU、单线程），因此四种深度方法按登记参数各训练一次，
不跳过、不把跳过写成通过。数据与经典方法同源：`openstack-six-v1`、
`openstack-six-v1-2011-11-29_2014-02-28`，测试集 1853 条（正例 286、负例 1567），
阈值 0.5，指标集 `metric-set-v1`。

## 环境

- Windows 11、Python 3.14.2、`torch 2.14.1+cpu`、CUDA 不可用（纯 CPU）
- 全部方法 `threads=1`、`seed=2026`、30 epochs、batch 256
- 训练产物只写入 `backend/.cache/deep/<方法>`（不入库）；汇总见
  [`deep-methods.json`](deep-methods.json)

## 复现命令

```powershell
cd backend
$keys = @('mlp-v1','tabular-resnet-v1','ft-transformer-v1','wide-deep-v1')
$runs = @()
foreach ($key in $keys) {
  .\.venv\Scripts\python.exe -m jit_baseline.cli run --schema openstack-six-v1 --algorithm $key --output ".cache\deep\$key"
  $runs += ".cache\deep\$key"
}
.\.venv\Scripts\python.exe -m jit_baseline.cli compare-methods @runs --report ..\docs\evidence\explain-predictions-and-verify-service\deep-methods.json
```

## 结果

| 方法 | ROC-AUC | AP | F1@0.5 | Recall@20%LOC | 训练秒数 |
| --- | --- | --- | --- | --- | --- |
| `mlp-v1`（MLP 64-32） | 0.7701 | 0.3813 | 0.0000 | 0.0524 | 16.1 |
| `tabular-resnet-v1`（2 残差块） | 0.7658 | 0.3791 | 0.0000 | 0.0769 | 20.1 |
| `ft-transformer-v1`（d_token=32/1 层） | 0.7639 | 0.3780 | 0.0000 | 0.0559 | 211.7 |
| `wide-deep-v1`（宽深双塔） | 0.7689 | 0.3848 | 0.0070 | 0.0699 | 14.4 |

## 解读与局限

- 四种深度方法的排序能力（ROC-AUC 0.764–0.770、AP 0.378–0.385）与同口径经典方法接近，
  没有出现「深度方法明显更好」的结论，也没有出现训练失败。
- 阈值 0.5 下三种方法一个正例都没预测出来（F1=0），`wide-deep-v1` 只命中 1 条。
  这是类别不平衡（正例 15.4%）加 30 epochs 下单线程 CPU 训练的校准结果，不是指标缺失：
  `compare-methods` 因此同时给出 AP 与 Recall@20%LOC 作为排序口径，F1 仅作如实记录。
- FT-Transformer 单线程 CPU 训练 211.7 s，约为 MLP 的 13 倍；它是本机最慢的一种，
  但没有超出可接受范围。
- 这些数字只说明「四种深度方法可在本机真实训练并给出指标」，不构成对方法的优劣结论；
  调参、更多 epochs 或 GPU 训练会得到不同数值，本记录不做外推。
