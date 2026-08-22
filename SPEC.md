# SPEC: Sync issue artifacts at each checkpoint push

- Issue: `ISSUE-816`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/816-checkpoint-artifact-sync`

## 目的・背景

GitHub モードで Issue 本文または PR 本文を成果物内容の正本として使う設定では、各セグメントの成果物が remote push 済みの commit に存在するだけでなく、GitHub 本文の固定同期マーカー内からも確認できなければならない。現状は同期が `gate publish` に依存するため、ゲート未到達、中断、またはゲート発行経路の制約で停止した Issue では、commit 済みの要求・設計・実装計画が GitHub 上に存在しないように見える。

本 Issue の目的は、各セグメントの checkpoint commit と remote push が成功した時点を成果物同期の契機に加え、ゲート発行前でも指定された GitHub 本文へ、その checkpoint の完全 SHA に固定した成果物内容を転記することである。実装セグメントでコードとテストだけが変わり成果物文書が変わらない checkpoint も同期契機に含む。checkpoint による耐久性の確保と GitHub 本文への転記は結果上独立させ、転記不能によって push 済み checkpoint を失敗扱いにしない。

関連する確定済み判断として、GitHub 本文の固定同期マーカー内に転記された成果物はゲートの判定軸へ読み戻してはならない。本仕様もこの境界を維持し、checkpoint 同期によってゲート状態を生成、承認、または変更しない。

## 用語

- checkpoint: セグメント成果物を commit し、その commit を対象 branch の remote へ push して、完全 SHA を確定する操作。
- checkpoint SHA: 当該 checkpoint が remote push に成功した commit の 40 桁完全 SHA。
- 成果物: checkpoint SHA の Git tree に存在する `SPEC.md`、`DESIGN.md`、`PLAN.md`、`VALIDATION.md`。
- 固定同期マーカー: 開始文字列 `<!-- agent-skill-chain:issue-sync:begin (do not edit manually) -->` と終了文字列 `<!-- agent-skill-chain:issue-sync:end -->` で囲む、agent-skill-chain が排他的に置換する区間。
- 成果物 payload: 成果物の元文字列へ可逆なマーカー無害化を適用し、固定同期マーカー文字列を含まなくした掲載文字列。
- 既存マーカー SHA: 対象本文の正常な固定同期マーカー区間に記録されている 40 桁完全 SHA。
- 同期トリガー: 成功した checkpoint、または対象ゲート結果を発行する `gate publish`。
- 対象本文: `issue_sync.target` が指定する `issue_body`、`pr_body`、または `both` のうち、対象 Issue または全ての関連 open PR を最終ページまで列挙した結果から一意に特定できる PR に実在する本文。
- 同期失敗: GitHub API エラー、PR 検索のページ取得失敗・不完全性・不在・複数該当、競合の未解消、本文上限への安全な縮退不能などにより、対象本文の固定同期マーカーを更新できない状態。

## 入力・出力

### 入力

- Coordination Backend のモード。
- `issue_sync.enabled`、`issue_sync.target`、`issue_sync.max_body_chars` の実効設定値。
- Issue ID、対象 branch、および同期対象の完全 SHA。checkpoint では remote push に成功した checkpoint SHA、`gate publish` では当該発行対象 SHA とする。
- 同期対象の完全 SHA に存在する成果物の内容。
- 対象となる GitHub Issue 本文と、一意に特定できる場合の open PR 本文。
- 同期トリガーの種別。`gate publish` の場合は、その呼び出しが発行する対象ゲートの直接利用可能な現在結果と判定対象の完全 SHA。

### 出力

- 有効条件を満たす場合、指定された各対象本文に対する排他的な同期結果。`synced_full` の固定同期マーカー内は対象の完全 SHA と実在する全成果物の全文を復元できる payload を含む。`synced_fallback` の固定同期マーカー内は対象の 40 桁完全 SHA と、その SHA を指す当該 repository の Git commit への明示的なポインタだけを含み、成果物は復元できない。`sync_failed_no_write` は対象本文を一切変更しない。
- 同期を完了できない場合、対象、理由、および同期対象の完全 SHA を識別できる警告。
- 同期結果にかかわらず、commit と remote push が成功している checkpoint の成功結果と checkpoint SHA。

## 要求 → 要件 → 受入条件

### 要求

GitHub モードかつ `issue_sync.enabled: true` の Issue では、成果物文書の変更有無にかかわらず各セグメントの checkpoint commit と push が成功した後、成功したゲートの発行を待たずに、指定された GitHub 本文へ成果物を同期する。実装セグメントでコードとテストだけが変わる checkpoint も対象とする。同期は checkpoint SHA に固定された内容だけを用い、既存の競合保護、本文上限、マーカー外不変、対象選択、未作成成果物の除外、および `gate publish` 時の同期との互換性を維持する。

### 要件

- Coordination Backend が `github` であり、かつ `issue_sync.enabled` が `true` の場合だけ、成功した各セグメントの checkpoint push それぞれの後に、成果物文書が変更されたか否かにかかわらず、各 checkpoint SHA に存在する成果物内容の同期を他の checkpoint と独立して best-effort で試行する。実装セグメントでコードとテストだけが変更され、`SPEC.md`、`DESIGN.md`、`PLAN.md`、`VALIDATION.md` のいずれも変更されない checkpoint も同期する。ローカルモードまたは明示的な無効化では GitHub 本文を変更しない。
- 同期元は branch の作業コピーや移動し得る branch tip ではなく、remote push に成功した checkpoint SHA の Git tree とする。同期結果にはその完全 SHA を含める。
- checkpoint SHA に存在する成果物だけを掲載し、存在する成果物はマーカー無害化以外の要約・抽出・改変をせず、復号により元文字列を完全に再現できる payload として全文を掲載する。後続セグメントの未作成成果物について、空の節、推測した内容、またはプレースホルダーを生成しない。
- `issue_sync.target` の `issue_body`、`pr_body`、`both` を尊重する。PR 本文は、対象 Issue と対象 branch に関連する全ての open PR を API の最終ページまで網羅的に列挙し、該当 PR が 1 件だけと確定できる場合に限り更新する。0 件、2 件以上、ページ取得もしくは API の一部でも失敗、または列挙結果の完全性に曖昧さがある場合は、PR 対象だけを `sync_failed_no_write` として一切書き込まない。`both` の一方を解決または更新できなくても、他方の同期は独立して試行する。
- 成果物 payload のマーカー無害化は、先に全ての `&` を `&amp;` へ置換し、次に成果物内の各開始・終了マーカー文字列の先頭 `<` だけを `&#60;` へ置換する。復号は、無害化された開始・終了マーカーを元の文字列へ戻した後、`&amp;` を `&` へ戻す逆順で行う。この変換により、元の `&amp;` や `&#60;` を含む成果物とも衝突せず、payload 内に固定同期マーカーと同一の文字列を残さない。
- 対象本文内の固定同期マーカーが 0 個なら区間を追加する。開始・終了が各 1 個で開始が終了より前にある場合だけ既存区間を置換する。それ以外の個数または順序は境界不正として書き込まない。追加・置換のいずれもマーカー外の人間記述を文字列として不変に保ち、同期の反復でマーカー区間を増殖させない。
- checkpoint と `gate publish` の双方で、全文ブロックまたは縮退ブロックを対象本文へ書き込む直前ごとに、候補の対象 SHA と既存マーカー SHA を Git commit の ancestry で比較する。固定同期マーカーが存在しない場合、候補 SHA が既存マーカー SHA と同一の場合、または既存マーカー SHA が候補 SHA の祖先である場合だけ書き込み可能とする。候補 SHA が既存マーカー SHA の祖先である古い候補、または両 SHA が相互に祖先でない比較不能な候補は、当該対象だけを `sync_failed_no_write` として本文を一切変更しない。これにより、新しい同期済み本文を古い候補または別履歴の候補で巻き戻さない。`both` の他方は独立して鮮度を判定する。
- ancestry 検査後かつ書き込み直前の本文変更を compare-and-swap 相当で検知する。安全に解消できない競合では当該候補を再取得した本文と既存マーカー SHA に対して再検査しない限り書き込まず、第三者の変更を保持して警告する。
- 対象本文ごとに、対象の完全 SHA と可逆な全成果物 payload を含む全文ブロックを含めた本文が `issue_sync.max_body_chars` 以下なら `synced_full` として書き込む。全文込みは上限を超えるが、対象の 40 桁完全 SHA と `https://github.com/<owner>/<repository>/commit/<40桁完全SHA>` 形式で同じ SHA を指す Git commit ポインタだけを固定同期マーカー内に含む縮退ブロックなら上限以下になる場合だけ、`synced_fallback` として書き込む。縮退ブロックは成果物 payload、成果物本文、ゲート結果を含まず、成果物へ可逆ではない。縮退込みも上限を超える場合は `sync_failed_no_write` とし、更新 API を呼ばず対象本文を文字列として完全に不変に保つ。3 状態は相互排他的であり、`synced_full` だけが全成果物を可逆に復元でき、上限超過を理由にマーカー外を削除または切り詰めない。
- checkpoint 同期の `synced_full` は、自身の checkpoint SHA を同期対象として表示し、その SHA のゲート状態を明示的に未判定と表示する。`synced_fallback` は完全 SHA と Git commit ポインタだけを表示し、ゲート状態を表示しない。いずれも過去または現在の Check Run、ゲート記録、一時記録から結果を推論、復元、または取得せず、他 Issue の履歴も走査しない。
- checkpoint 同期は Check Run、ゲート承認、ゲート通過、または新たなゲート状態を生成・変更してはならない。転記内容を後続のゲート判定入力へ読み戻してはならない。
- 同期失敗は警告として観測可能にするが、commit と remote push が成功した checkpoint の成功結果を失敗へ変更しない。複数対象の一部失敗も、成功可能な他方の更新を取り消さない。
- `gate publish` は checkpoint 同期と同一の成果物 writer を使う。`synced_full` では発行対象の完全 SHA と、その呼び出しで即時に利用できる現在の対象ゲート結果だけを同期し、`synced_fallback` では完全 SHA と Git commit ポインタだけを同期する。他ゲートや過去の結果を推論、復元、または取得せず、checkpoint と同じ対象選択・固定マーカー保護・競合検知・上限処理を適用する。

同期呼び出しの状態は排他的である。有効条件を満たさない呼び出し全体だけを `not_applicable` とし、この場合は対象別状態を生成しない。有効な呼び出しでは、設定上の各対象本文に `synced_full`、`synced_fallback`、`sync_failed_no_write` のいずれか一つだけを付与する。`synced_full` は対象の完全 SHA と可逆な全成果物 payload を含む本文へ更新済み、`synced_fallback` は対象の完全 SHA とその Git commit への明示的なポインタだけを含む非可逆な本文へ更新済み、`sync_failed_no_write` は更新 API を呼ばず本文が同期呼び出し前と完全に同一、をそれぞれ意味する。対象解決不能、境界不正、縮退不能、古いまたは比較不能な候補 SHA、未解消競合、列挙の曖昧さ、ページ取得失敗、その他の API エラーは `sync_failed_no_write` であり、当該対象へ書き込まない。`both` では Issue 本文と PR 本文がそれぞれ独立に状態を取り、一方の結果を他方へ波及させない。

### 受入条件（Acceptance Criteria）

#### AC-1: 成果物文書が変わらない実装 checkpoint もゲート未到達で同期される

- Given: Coordination Backend が GitHub、`issue_sync.enabled: true` であり、要求・設計・実装計画・検証の成果物 checkpoint、またはコードとテストだけが変更され `SPEC.md`、`DESIGN.md`、`PLAN.md`、`VALIDATION.md` のいずれも変更されない実装セグメントの checkpoint が、まだゲートを通過していない
- When: checkpoint の commit と remote push が成功する
- Then: `gate publish` を実行しなくても、成果物文書の差分有無にかかわらず、設定された既存の対象本文の固定同期マーカー内へ checkpoint SHA とその SHA に存在する成果物が同期される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: ゲート未到達の SPEC、DESIGN、PLAN、VALIDATION 各 checkpoint に加え、直前の同期済み SHA からコードファイルとテストファイルだけを変更して全成果物文書の blob SHA が不変な実装セグメント checkpoint を順に実行し、5 回それぞれの push 後に GitHub 更新 API が呼ばれ、マーカー SHA が当該 checkpoint SHA へ進み、その Git tree に存在する成果物 payload が一致することを検査する統合テストログ

#### AC-2: 無効条件では GitHub 本文を変更しない

- Given: Coordination Backend がローカル、または `issue_sync.enabled: false` である
- When: 成果物を含む checkpoint の commit と push が成功する
- Then: Issue 本文と PR 本文への読み書きによる成果物同期は行われず、checkpoint は従来どおり完了する
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: backend と enabled の組合せごとに GitHub 本文の更新呼び出しが無いことを検査する自動テストログ

#### AC-3: 同期元を push 済み checkpoint SHA に固定する

- Given: checkpoint SHA と、その後に内容が異なる作業コピーまたは branch tip が存在する
- When: checkpoint 後の成果物同期が行われる
- Then: 同期される完全 SHA と各成果物の全文は checkpoint SHA の Git tree に一致し、後発の未 push 内容を含まない
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: checkpoint SHA と作業コピーに異なる内容を置き、同期本文を checkpoint SHA の `git show` 結果と照合する統合テストログ

#### AC-4: target ごとの対象選択と独立性を守る

- Given: `issue_sync.target` が `issue_body`、`pr_body`、または `both` のいずれかである
- When: checkpoint 後の同期が行われる
- Then: 指定された対象だけが更新され、`both` の一方が未解決または失敗でも他方の同期は試行され、無効な呼び出しだけが `not_applicable`、有効な各対象は `synced_full`、`synced_fallback`、`sync_failed_no_write` のいずれか一つだけとなる
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 3 種の target、無効条件、および `both` の一方の失敗を組み合わせ、更新対象、独立性、排他的な結果状態を検査する統合テストログ

#### AC-5: 関連 open PR を最終ページまで検索して一意性を確定する

- Given: PR 本文が同期対象であり、対象 Issue と branch に関連する open PR が 0 件、1 件、2 件以上のいずれかで、結果が複数ページに分かれ得る
- When: checkpoint または `gate publish` の同期が PR 対象を解決する
- Then: 全ての関連 open PR を最終ページまで列挙した後に 1 件だけと確定できる場合に限り更新し、0 件、2 件以上、ページ取得もしくは API の一部でも失敗、または完全性が曖昧な場合は PR 対象だけが `sync_failed_no_write` となる
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 0 件・1 件・2 件以上、1 ページ・複数ページ、中間ページ・最終ページの失敗、不完全なページネーション情報を組み合わせ、PR 書き込みと Issue 側の独立性を検査する統合テストログ

#### AC-6: マーカー境界とマーカー外の内容を保護する

- Given: 対象本文にマーカー外の人間記述があり、固定同期マーカーが 0 組、正常な 1 組、または個数・順序が不正な状態で、書き込み前に第三者更新が起こり得る
- When: checkpoint 同期を初回または反復実行する
- Then: 0 組では一組を追加し、正常な 1 組ではその区間だけを置換し、境界不正または未解消競合では書き込まず警告し、いずれもマーカー外の内容を不変に保つ
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 初回追加、反復置換、開始・終了の欠落・重複・逆転、同一内容再実行、および競合注入後の本文全体と警告を比較する自動テストログ

#### AC-7: 本文サイズ上限を安全に守る

- Given: 同一のマーカー外本文に対して、全文ブロックを含む本文と checkpoint SHA 付き縮退ブロックを含む本文の生成後文字数が既知である
- When: checkpoint 同期が対象本文を生成する
- Then: 全文込みが上限以下なら、完全 SHA と可逆な全成果物 payload を含む `synced_full`、全文込みは上限超過だが縮退込みが上限以下なら、40 桁完全 SHA と同じ SHA の Git commit への明示的なポインタだけを含み成果物を復元できない `synced_fallback`、縮退込みも上限超過なら、更新 API を呼ばず本文全体が呼び出し前と同一の `sync_failed_no_write` の一つだけとなり、全状態でマーカー外の内容を変更しない
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 全文が上限ちょうど、全文が 1 文字超過して縮退可能、マーカー外が縮退の最小領域も残さない場合について、状態が一つだけであること、`synced_full` の payload 復号が全成果物と一致すること、`synced_fallback` のマーカー内が 40 桁完全 SHA と同じ SHA を末尾に持つ commit URL だけで成果物 payload・成果物本文・ゲート結果を含まず復元不能であること、`sync_failed_no_write` では更新 API 呼び出しが 0 回で本文が byte-for-byte 不変であることを検査する自動テストログ

#### AC-8: 成果物を可逆に無害化し未作成成果物を掲載しない

- Given: checkpoint SHA には 4 成果物の一部だけが存在し、その内容には開始・終了マーカー文字列、`&amp;`、または `&#60;` と同じ文字列が含まれ得る
- When: checkpoint 同期が固定同期マーカーを生成する
- Then: 存在する成果物だけが規定の可逆変換による payload として掲載され、payload 内に固定同期マーカーと同一の文字列は無く、復号結果は元の成果物全文と一致し、存在しない成果物の節、推測内容、またはプレースホルダーは掲載されない
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: SPEC のみ、SPEC・DESIGN、SPEC・DESIGN・PLAN、4 成果物すべての各 Git tree と、両マーカーおよびエスケープ表記を含む成果物について、境界数、payload の復号一致、未作成節の不在を検査するログ

#### AC-9: checkpoint の全文同期は対象 SHA を未判定と表示し履歴を参照しない

- Given: 対象 checkpoint SHA と、同一または異なる SHA の過去もしくは現在の Check Run、ゲート記録、一時記録、または他 Issue の履歴が存在し得る
- When: checkpoint 後の同期が行われる
- Then: `synced_full` では checkpoint の完全 SHA と当該 SHA が未判定であることだけがゲート情報として表示され、`synced_fallback` では完全 SHA と Git commit ポインタ以外を表示せず、いずれも Check Run 履歴取得、ゲート結果の推論・復元、一時記録への縮退、他 Issue の履歴走査、新たな Check Run・承認・通過・状態変更は発生せず、同期マーカー内の内容はゲート判定入力から除外される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 既存の同一 SHA・異なる SHA・他 Issue の結果と一時記録を fixture に置いて checkpoint 同期を実行し、`synced_full` の未判定表示、`synced_fallback` にゲート情報が無いこと、履歴 API 呼び出しの不在、同期前後の Check Run・ゲート状態の不変、および判定入力から同期区間が除外されることを検査する自動テストログ

#### AC-10: 同期失敗が push 済み checkpoint の耐久性を破壊しない

- Given: checkpoint の commit と remote push は成功し、その後の GitHub API エラー、境界不正、縮退不能、競合、または対象解決不能により一部または全部の同期が失敗する
- When: checkpoint 処理が完了する
- Then: checkpoint は成功と完全 SHA を返し、remote branch はその SHA を指し、同期失敗の対象・理由・SHAが警告として観測でき、成功した別対象の更新は保持される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 同期失敗を注入した checkpoint の終了コード、標準出力、警告、remote ref、および対象本文を検査する統合テストログ

#### AC-11: gate publish は直接利用できる現在の対象ゲート結果だけを同期する

- Given: checkpoint 同期後に同じ Issue のゲートが発行され、`issue_sync` が有効である
- When: `gate publish` が実行される
- Then: checkpoint と同一の成果物 writer が、`synced_full` では発行対象の完全 SHA と当該呼び出しに直接渡された現在の対象ゲート結果だけで固定同期マーカーを更新し、`synced_fallback` では完全 SHA と Git commit ポインタだけで更新し、他ゲートや過去の結果の推論・取得・復元、一時記録への縮退、他 Issue の履歴走査を行わず、target、可逆なマーカー無害化、境界検査、書き込み前の ancestry による鮮度検査、競合保護、マーカー外不変、排他的な本文上限状態、未作成成果物除外、および同期失敗の非致命性を checkpoint 同期と共有する
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 複数ゲートと過去結果を fixture に置き、各 `gate publish` に直接渡した 1 件の現在結果だけが表示されること、履歴 API 呼び出しが無いこと、および checkpoint と共有する writer 契約を検査する統合テストログ

#### AC-12: checkpoint と gate publish の同期鮮度は単調に進む

- Given: 対象本文の固定同期マーカーに既存マーカー SHA があり、checkpoint または `gate publish` の候補 SHA が同一 SHA、既存 SHA の子孫、既存 SHA の祖先、または既存 SHA と相互に祖先でない別履歴の SHA である
- When: 全文ブロックまたは縮退ブロックの書き込みを試行する
- Then: 各書き込みの直前に候補 SHA と既存マーカー SHA を ancestry で比較し、同一または子孫の候補だけを書き込み可能とし、古い祖先候補と比較不能な候補は当該対象だけが `sync_failed_no_write` となって更新 API を呼ばず、より新しい同期済み本文を巻き戻さない
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: checkpoint と `gate publish` の双方について、同一・子孫・祖先・別履歴の各候補を全文ブロックと縮退ブロックの両経路で実行し、全 write 試行前に ancestry 検査が呼ばれること、同一・子孫だけが更新されること、祖先・別履歴では対象別状態が `sync_failed_no_write`、更新 API 呼び出しが 0 回、本文が byte-for-byte 不変で既存マーカー SHA が維持されること、および `both` の他方は独立に更新可能であることを検査する統合テストログ

## 制約

- 成果物同期は Git から GitHub 本文への一方向転記であり、GitHub 本文を成果物ファイルへ逆同期しない。
- checkpoint の成功条件である commit と remote push を緩和しない。push 失敗時には同期を行わず、従来どおり checkpoint を失敗とする。
- 同期失敗を黙殺せず、後から失敗した対象と checkpoint SHA を特定できる診断を残す。
- 固定同期マーカーの文字列と、ゲート判定入力から同期区間を除外する契約を同時に維持する。
- 新たな設定項目を要求しない。既存の `enabled`、`target`、`max_body_chars` の意味を維持する。

## 完了条件・検証方法

- AC-1 から AC-12 が自動テストに一意に対応し、SPEC、DESIGN、PLAN、VALIDATION の全 checkpoint と、コード・テストだけが変わり成果物文書が変わらない実装セグメント checkpoint を含む検証結果および実行ログが `VALIDATION.md` の同じ AC-ID の `verification.mode` と `evidence` に記録される。
- checkpoint 単体の成功・失敗、成果物文書が不変な実装 checkpoint を含む各 checkpoint の独立した best-effort 同期、3 状態の排他性と厳密な本文内容、checkpoint と `gate publish` の全 write 前 ancestry 検査、古い・比較不能な候補による巻き戻しの不在、GitHub API を模擬する統合テスト、最終ページまでの PR 一意性検索、履歴参照の不在、checkpoint の未判定表示、`gate publish` の直接利用可能な現在結果だけの表示、既存 issue-sync 回帰テスト、および repository の常時必須検査が成功する。
- spec checkpoint 前に、次の静的検査を foreground で完了し、すべて終了コード 0 を確認する。
  - `.agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md`
  - `npm run build`
  - `.agent-skill-chain/ci/verify-doc-length.sh`
  - `.agent-skill-chain/scripts/lint-vocab.sh`
  - `.agent-skill-chain/scripts/lint-references.sh`

## 未決事項

なし。本仕様で対象条件、成果物文書が不変な実装 checkpoint を含む 4 セグメントの同期契機、SHA の固定、全 write 前の単調な ancestry 鮮度検査、最終ページまでの PR 一意性検索、マーカー無害化、境界不正時・競合時・上限超過時・同期失敗時の排他的な挙動、checkpoint の明示的な未判定表示、および `gate publish` の現在の対象ゲート結果だけの同期を確定する。

## スコープ外

- 検出済みの #798 / PR #804、#808 / PR #809、#814 / PR #815 に対する補正転記。これらは既存同期機能による運用回復が完了しており、本 Issue は今後の checkpoint における再発防止だけを扱う。
- Issue/PR 本文の固定同期マーカー外を機械編集すること。
- GitHub 以外の Coordination Backend の成果物正本または耐久性モデルを変更すること。
- 同期された本文をゲート判定、成果物検証、または成果物ファイル生成の入力にすること。
- ゲートの通過条件、レビュー判定、Check Run の発行条件、または既存ゲート状態の意味を変更すること。
- checkpoint で過去・現在の Check Run 履歴を取得すること、一時記録からゲート結果を復元すること、または他 Issue の履歴を走査すること。
- #814 の reasoning effort policy の内容を変更すること。
- GitHub 本文上限を超える成果物をコメントや外部ストレージへ分割保存する新方式を追加すること。
