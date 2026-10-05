# 観測性・性能・耐障害性のLens

## 適用条件

hot path、batch、query、log、telemetry、外部APIの失敗や遅延を扱うとき。

## 判断する問い

- 測定対象とprojectのperformance budgetは何か。
- N+1、無制限batch、不要なI/Oはないか。
- timeout・cancel・部分失敗で資源を解放できるか。
- retryとbackpressureで負荷を増幅しないか。
- 診断に必要な情報だけをPIIやsecretなしで残せるか。
- 障害時に利用者が復旧できるか。

## 代表的な失敗

計測なしの最適化、無制限retry、過剰logging、障害を成功扱いするfallback。

## scope内の修正

対象経路を計測し、既存patternでquery・資源解放・timeout・失敗診断を修正する。

## 既存手続きへの接続

外部contract、security境界、scope変更を要するときはStep 9の既存処理へ渡す。

## 通常は助言に留めること

無関係なmetricsやloggingを追加しない。機能の実行性能とStep 9の実装所要時間を区別する。
