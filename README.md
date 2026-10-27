# jp-address2osm

日本の住所の文字列を、OSMのaddrタグに分けるサーバです。
住居表示の住所か、地番の住所かも、アドレス・ベース・レジストリ（以下ABR）の台帳で判定します。
番地が住居表示か地番か判定できず推測したときは、住居表示の候補と地番の候補を並べて返します。

分割には`nja-osm-tags`（`vendor/nja-osm-tags`のsubmodule）を使います。
HTTPのAPIと、そのAPIを呼ぶWebページを、1つのNodeのプロセスから配信します。
APIの使い方は`docs/api.md`に書いています。

ページのパスは次のとおりです。

| パス | 中身 |
|---|---|
| `/` | 住所を貼って、タグに分ける画面 |
| `/guide` | 使い方 |
| `/data` | データと方針（出典、利用規約、記録の方針） |
| `/api` | APIの説明（`docs/api.md`をページにしたもの） |
| `/api/openapi.yaml` | APIのOpenAPI 3.1の定義（`docs/openapi.yaml`） |

## 必要なもの

型を取り除いてTypeScriptをそのまま動かすため、Node 22.18以上が要ります。
住所データには、japanese-addresses-v2の出力（`out/api/ja`）を使います。
全国分で約5.2GBです。

## 準備

```
git clone --recurse-submodules https://github.com/nyampire/jp-address2osm.git
cd jp-address2osm
npm ci
npm ci --prefix vendor/nja-osm-tags
```

ルートの`npm ci`は、TypeScriptと`@types/node`を入れます。
`vendor/nja-osm-tags`の`npm ci`は、nja-osm-tagsが使うパッケージを入れます。
`fsevents`のinstall scriptについての警告が出ますが、テストの監視に使うmacOS向けのパッケージで、動作には関係しません。

### 住所データ

住所データは、[japanese-addresses-v2](https://github.com/geolonia/japanese-addresses-v2)を手元に置き、そのスクリプトで作ります。
手順と、Node 26で要る回避は、nja-osm-tagsの[docs/local-mirror.md](vendor/nja-osm-tags/docs/local-mirror.md)にあります。

全国分は、作るのに4時間半前後かかり、出力が約5.2GB、途中のキャッシュが約3.4GBになります（2026-08-24の実測）。
動作を試すだけなら、`SETTINGS_JSON`で自治体を絞った一部だけを作れます（同じ文書の「対象を絞る」の節）。
絞った場合は、含めた都道府県の住所だけが分けられます。

## 環境変数

| 名前 | 内容 | 既定値 |
|---|---|---|
| `NJA_API_BASE` | 住所データ（`out/api/ja`）の場所。`file://`のURLか、ディレクトリのパスです。必須です。 | 無し |
| `PORT` | 待ち受けるポート番号。 | `8787` |
| `FAILURE_LOG` | 分けられなかった住所を追記するファイルのパス。1行に1件のJSONで書きます。指定しなければ記録しません。 | 無し |
| `RATE_LIMIT_PER_MIN` | 送り元のIPアドレスごとの、1分あたりの要求の上限。正の数でなければ既定値にします。 | `60` |
| `TRUST_PROXY` | `true`または`1`のとき、`X-Forwarded-For`の右端のアドレス（信頼するプロキシが足した値）を送り元として数えます。リバースプロキシの後ろで動かすときに指定します。 | 無効 |
| `WORKER_HEAP_LIMIT_MB` | 分割処理を動かすworkerのヒープの上限（MB）。超えたらworkerを作り直します（「メモリ」の節）。正の数でなければ既定値にします。 | `400` |

## 起動

```
NJA_API_BASE=/path/to/japanese-addresses-v2/out/api/ja \
FAILURE_LOG=/var/log/jp-address2osm/failures.jsonl \
npm start
```

起動すると、標準エラー出力に`listening on :8787`と出ます。
ブラウザで`http://localhost:8787/`を開くとWebページが、`POST /api/v1/parse`でAPIが使えます。

住所データ（japanese-addresses-v2の出力）を更新したら、サーバを再起動してください。
住所の台帳は、NJAも地番の判定も、メモリに載せたまま使い続けるためです。

### メモリ

NJAは、要求の来た市区町村の町字の一覧などを上限なしにメモリへためます。
全国から要求が来ると、そのままでは1GBを超えます。
そこで、分割処理はworker thread（同じプロセスの中の別スレッド）で動かし、キャッシュが大きくなったらworkerを作り直して捨てます。

workerは1件処理するたびにヒープの使用量を測り、`WORKER_HEAP_LIMIT_MB`を超えていたら、回収前のゴミを片付けてから測り直します。
片付けた後もキャッシュが上限の8割を超えていれば、作り直しを頼みます。
作り直しの前に受けた要求は、古いworkerが返し終えてから止めます。
workerのヒープの最大値は上限の1.25倍に固定しているので、ヒープはそれ以上広がりません。
ただし、この使用量にはBufferなどヒープの外のメモリは入りません。

10秒たっても返らない要求は失敗させ、そのworkerを止めます。
workerが落ちたときは、抱えていた要求が失敗し、次の要求が来たときに新しいworkerを立てます。

標準エラー出力には、作り直したときに`parse worker replaced`、予定外に止まったときに`parse worker exited`と出ます。
`WORKER_HEAP_LIMIT_MB`は128未満を指定しても128になります。
それより小さいと、workerが住所データを読み込む前に上限に達するためです。

既定値の400MBでは、プロセス全体のメモリ（workerを含むRSS）は最大で約690MB、平均で約590MBでした。
全国の医療機関の住所から無作為に選んだ1.2万件を4本並べて送り続け、0.2秒ごとに測った値です（2026-10-20、macOS、Node 26）。
このとき、workerの作り直しは約800件に1回で、失敗した要求はありませんでした。
使えるメモリが少ないときは`WORKER_HEAP_LIMIT_MB`を下げます。
作り直しが増え、作り直した直後の数件は台帳を読み直すぶん遅くなります。

`FAILURE_LOG`のファイルは、上限なしに大きくなります。
logrotateで回してください。
書き込みのたびにファイルを開き直すので、ファイルを移すだけで回せます。

## テストと型の検査

```
npm test
npm run typecheck
```

## 出力される住所データ

住所データは、デジタル庁と国土交通省が配布する元データを、[japanese-addresses-v2](https://github.com/geolonia/japanese-addresses-v2)のスクリプトで手元で加工したものです。
Geoloniaが公開している加工済みの住所データは使っていません。

出典:

* 「[アドレス・ベース・レジストリ](https://www.digital.go.jp/policies/base_registry_address)」（デジタル庁）をもとに、[japanese-addresses-v2](https://github.com/geolonia/japanese-addresses-v2)のスクリプトで加工して作成
* 「[位置参照情報ダウンロードサービス](https://nlftp.mlit.go.jp/isj/)」（国土交通省）をもとに、[japanese-addresses-v2](https://github.com/geolonia/japanese-addresses-v2)のスクリプトで加工して作成

位置参照情報は、アドレス・ベース・レジストリに無い町字を補うために使われています。

アドレス・ベース・レジストリと位置参照情報には、どちらも[公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)が適用されます（位置参照情報は[国土数値情報ダウンロードサイトの利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement.html)による）。
地番マスターと地番マスター位置参照には[登記所備付地図データ利用規約](https://www.digital.go.jp/policies/base_registry_address_tos)が別途適用されます。
地番の台帳から取った番地は、タグ（`addr:full`を含む）にして出力しません。座標も出力しません。
どちらも、この規約がOSMのライセンスと両立しないためです（[nja-osm-tagsのライセンス上の制約](vendor/nja-osm-tags/README.md#ライセンス上の制約)）。

## ライセンス

コードは[MIT License](LICENSE)です。
住所データには、上の「出力される住所データ」の節に書いた規約が適用されます。
