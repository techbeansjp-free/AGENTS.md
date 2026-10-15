# Owner署名承認（評価実装）

Node.js >=20の標準Ed25519検証を使用する。秘密鍵の生成・保管・署名操作はowner側で行い、実装Agent、Reviewer、候補repositoryへ秘密鍵を渡さない。Controllerはhost policyから公開鍵・fingerprint・authority名・purposeを受け取る。候補が指定した公開鍵を信頼することは禁止。CLIのstdinはtrusted host入力であり、このCLIを単独で実行した結果を正式承認へ昇格させるものではない。

`src/approval.mjs`の`approvalBytes(payload)`が署名対象の正規表現形式を返す。schemaは`asc-owner-approval/v1`、purposeは`design`のみ。payloadはauthority、Contract digest、基点commit、Controllerが新規生成した256bit scope、issuedAt/expiresAt（Unix milliseconds）を含む。`crypto.sign(null, approvalBytes(payload), ownerPrivateKey)`の64byte結果をbase64化してsignatureとする。最大有効期間は24時間、未来発行・期限境界以降は拒否する。

Contract digestには元Intent、受入条件、設計、リスク、検証コマンド、許可path、policy revisionを含む。Controller再起動はscopeを変更するので、同じHEADでも前回の署名は使えない。承認後も各protected target観測で署名・期限・bindingを再検証する。失敗した承認を以前の成功へfallbackしない。

承認取得後、作業が進む前に再び期限切れとなった場合、同じ実行で署名要求を繰り返さず停止する。ownerは有効期間とIntent取得の遅延を確認し、原因を解消して新しい実行を開始する。承認条件は緩和せず、新しいscopeへの署名を取得する。この停止状態は他のIssueや次の実行には持ち越さない。

Python評価Controllerへはhostが`SignedAuthority(nodeAbsolutePath, trustedKeys, envelope)`を渡す。`nodeAbsolutePath`はhostが選ぶ実行ファイルであり、候補のPATHから探索させない。汎用callbackは既存fixture用に残るが、それだけで実運用owner認証を実証したことにはならない。

このadapterが証明するのは固定公開鍵の所持者による当該designの承認であり、実在人物の身元や業務上の権限ではない。鍵登録・失効・owner roleの管理はhost policyの責務。署名はmerge/release/network権限を付与しない。今回の試験鍵はすべて使い捨てのdummy鍵であり、実利用者の正式承認ではない。
