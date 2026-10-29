# 住所分割API

日本の住所の文字列を、OSMのaddrタグに分けて返すHTTPのAPIです。
外部のプログラム（JOSMのプラグイン、RapidやiDのユーザスクリプト、スクリプトなど）から呼べます。
鍵や利用者の登録は要りません。

OpenAPI 3.1の形式の定義を、[`/api/openapi.yaml`](/api/openapi.yaml)で配信しています。
呼び出し用のコードを生成したり、APIを試すツールに読み込んだりするときに使えます。
項目と値の定義は、この文書とOpenAPIの定義で同じです。

このAPIがすること。

1. 住所の文字列から郵便番号を切り出し、都道府県から番地までを区切ります。
2. 住居表示の住所か、地番の住所かを、アドレス・ベース・レジストリ（以下ABR）の台帳で判定します。
3. 番地が住居表示か地番か判定できず推測したときは、住居表示の候補と地番の候補を2つ並べて返します。
4. ABRが住居表示の実施済みとしている町字で、番地が住居表示の台帳にも地番の台帳にも無いときは、住居表示と推測した候補に`guessed: true`を付けて返します。
5. 番地の後ろの文字列から、建物名、階、部屋番号の候補を`optionalTags`として返します。

このAPIがしないこと。

1. 座標は返しません。
2. 地番の台帳から取った番地は、タグにして返しません。地番の住所の`tags`は`addr:neighbourhood`までと`addr:full`です。
3. 建物名や階数などの番地の後ろの文字列は、`tags`には入れません。`segments`に`remainder`として、`tagged`を偽にして返します。候補としては`optionalTags`に分けて返します。
4. `name`は返しません。

## 要求

```
POST /api/v1/parse
Content-Type: application/json

{"address": "高知県高知市北本町１ー２ー６"}
```

POSTだけを受け付けます。
GETで住所をURLに入れるとリバースプロキシのアクセスログに住所が残るため、GETでは受け付けません。
本文は8KBまでです。
`address`は200文字までの空でない文字列で、全角と半角のどちらでも指定できます。
一度に分けられる住所は1件です。

## 応答の例

要求の形が正しければ、分けられたかどうかにかかわらず、HTTPの状態コード200で次の形のJSONを返します。
以下は、起動したサーバに`curl`で要求した出力です。

### 住居表示と判定された住所

```
curl -s -X POST http://localhost:8787/api/v1/parse \
  -H 'Content-Type: application/json' \
  -d '{"address":"高知県高知市北本町１ー２ー６"}' | jq .
```

```json
{
  "apiVersion": "1",
  "result": "jukyo",
  "message": "住居表示の住所です。住居表示の台帳に、北本町一丁目の2-6があります。",
  "segments": [
    {
      "value": "高知県",
      "role": "prefecture",
      "tagged": true
    },
    {
      "value": "高知市",
      "role": "city",
      "tagged": true
    },
    {
      "value": "北本町一丁目",
      "role": "neighbourhood",
      "tagged": true
    },
    {
      "value": "2",
      "role": "block_number",
      "tagged": true
    },
    {
      "value": "6",
      "role": "housenumber",
      "tagged": true
    }
  ],
  "candidates": [
    {
      "kind": "jukyo",
      "tags": {
        "addr:province": "高知県",
        "addr:city": "高知市",
        "addr:neighbourhood": "北本町一丁目",
        "addr:block_number": "2",
        "addr:housenumber": "6",
        "addr:full": "高知県高知市北本町一丁目2-6"
      }
    }
  ]
}
```

### 地番と判定された住所

地番の番地`1513-1`は、`chiban`の区切りとして示し、`addr:block_number`などのタグにはしません。
`addr:full`には、貼られた文字列から取った番地が入ります。

```
curl -s -X POST http://localhost:8787/api/v1/parse \
  -H 'Content-Type: application/json' \
  -d '{"address":"高知県安芸郡芸西村和食甲１５１３－１"}' | jq .
```

```json
{
  "apiVersion": "1",
  "result": "chiban",
  "message": "地番の住所です。和食甲は住居表示を実施していない町字です。番地はタグにしません。",
  "segments": [
    {
      "value": "高知県",
      "role": "prefecture",
      "tagged": true
    },
    {
      "value": "安芸郡",
      "role": "county",
      "tagged": true
    },
    {
      "value": "芸西村",
      "role": "city",
      "tagged": true
    },
    {
      "value": "和食",
      "role": "quarter",
      "tagged": true
    },
    {
      "value": "甲",
      "role": "neighbourhood",
      "tagged": true
    },
    {
      "value": "1513-1",
      "role": "chiban",
      "tagged": false
    }
  ],
  "candidates": [
    {
      "kind": "chiban",
      "tags": {
        "addr:province": "高知県",
        "addr:county": "安芸郡",
        "addr:city": "芸西村",
        "addr:quarter": "和食",
        "addr:neighbourhood": "甲",
        "addr:full": "高知県安芸郡芸西村和食甲1513-1"
      },
      "note": "地番の「1513-1」はタグにしません。"
    }
  ]
}
```

### 決められない住所（推測）

番地が住居表示か地番かを台帳でも決められず推測したときは、`jukyo`と`chiban`の2つの候補を並べて返します。
画面では、推測した住居表示の候補を先に見せます。
2つの候補を返すのは、ABRが町字を住居表示の実施済みとしているのに、番地が住居表示の台帳にも地番の台帳にも無い住所のときです。
このとき`jukyo`の候補に`guessed: true`を付けます。
これは、台帳の欠けの可能性が高いと見て、住居表示と推測したことを示します。
呼び出し側は、推測であることを利用者に示してください。
`chiban`の候補は、番地を入れずに町字で止めた版です。

```
curl -s -X POST http://localhost:8787/api/v1/parse \
  -H 'Content-Type: application/json' \
  -d '{"address":"高知県四万十市中村一条通３ー２ー２３"}' | jq .
```

```json
{
  "apiVersion": "1",
  "result": "ambiguous",
  "message": "住居表示の住所と推測しました。ABRは中村一条通三丁目を住居表示の実施済みとしていますが、住居表示の台帳がなく、地番の台帳にも「2-23」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。",
  "segments": [
    {
      "value": "高知県",
      "role": "prefecture",
      "tagged": true
    },
    {
      "value": "四万十市",
      "role": "city",
      "tagged": true
    },
    {
      "value": "中村一条通三丁目",
      "role": "neighbourhood",
      "tagged": true
    },
    {
      "value": "2-23",
      "role": "number_undecided",
      "tagged": true
    }
  ],
  "candidates": [
    {
      "kind": "jukyo",
      "tags": {
        "addr:province": "高知県",
        "addr:city": "四万十市",
        "addr:neighbourhood": "中村一条通三丁目",
        "addr:block_number": "2",
        "addr:housenumber": "23",
        "addr:full": "高知県四万十市中村一条通三丁目2-23"
      },
      "guessed": true
    },
    {
      "kind": "chiban",
      "tags": {
        "addr:province": "高知県",
        "addr:city": "四万十市",
        "addr:neighbourhood": "中村一条通三丁目",
        "addr:full": "高知県四万十市中村一条通三丁目2-23"
      },
      "note": "地番の「2-23」はタグにしません。"
    }
  ]
}
```

### 建物名、階、部屋番号のある住所

番地の後ろに建物名などがあるとき、候補に`optionalTags`が付きます。
`tags`には入りません。
`addr:full`には、建物名などが残ります。

```
curl -s -X POST http://localhost:8787/api/v1/parse \
  -H 'Content-Type: application/json' \
  -d '{"address":"高知県高知市北本町１ー２ー６ 中村ビル３階 ３０１号室"}' | jq .
```

```json
{
  "apiVersion": "1",
  "result": "jukyo",
  "message": "住居表示の住所です。住居表示の台帳に、北本町一丁目の2-6があります。",
  "segments": [
    {
      "value": "高知県",
      "role": "prefecture",
      "tagged": true
    },
    {
      "value": "高知市",
      "role": "city",
      "tagged": true
    },
    {
      "value": "北本町一丁目",
      "role": "neighbourhood",
      "tagged": true
    },
    {
      "value": "2",
      "role": "block_number",
      "tagged": true
    },
    {
      "value": "6",
      "role": "housenumber",
      "tagged": true
    },
    {
      "value": "中村ビル3階 301号室",
      "role": "remainder",
      "tagged": false
    }
  ],
  "candidates": [
    {
      "kind": "jukyo",
      "tags": {
        "addr:province": "高知県",
        "addr:city": "高知市",
        "addr:neighbourhood": "北本町一丁目",
        "addr:block_number": "2",
        "addr:housenumber": "6",
        "addr:full": "高知県高知市北本町一丁目2-6 中村ビル3階 301号室"
      },
      "optionalTags": {
        "addr:housename": "中村ビル",
        "addr:unit": "301",
        "addr:floor": "3"
      }
    }
  ]
}
```

### 分けられない住所

町字を特定できなかった住所は、誤りではなく、HTTPの状態コード200で`result`を`unresolved`にして返します。
`candidates`は空です。

```
curl -s -X POST http://localhost:8787/api/v1/parse \
  -H 'Content-Type: application/json' \
  -d '{"address":"存在しない県の何か"}' | jq .
```

```json
{
  "apiVersion": "1",
  "result": "unresolved",
  "message": "町字を特定できず、住所を分けられませんでした。この住所は改善のために記録します。",
  "segments": [
    {
      "value": "存在しない県の何か",
      "role": "remainder",
      "tagged": false
    }
  ],
  "candidates": []
}
```

`jq .`は表示を整えるためのもので、APIの利用には要りません。

## 応答の項目

| 項目 | 内容 |
|---|---|
| `apiVersion` | APIの版。v1では文字列の`"1"`です。 |
| `result` | 判定の種類。値は後の表のとおりです。 |
| `message` | 判定の説明文（日本語）。人に見せるためのものです。プログラムは`message`の文面で分岐せず、`result`と`role`で分岐してください。 |
| `segments` | 読み取った区切りの並び。入力の順に並びます。 |
| `candidates` | 候補の並び。0から2つです。 |

### `result`の値

| 値 | 意味 | `candidates` |
|---|---|---|
| `jukyo` | 住居表示の住所です。 | `jukyo`の1つ |
| `chiban` | 地番の住所です。 | `chiban`の1つ |
| `ambiguous` | 住居表示か地番かを決められません。または、住居表示と推測しました。 | `jukyo`、`chiban`の順に2つ。または、町字までの`town`の1つ。推測のときは`jukyo`に`guessed: true`が付きます |
| `unresolved` | 町字を特定できず、分けられませんでした。 | 空 |

`jukyo`でも、番地を読み取れなかったときは町字までのタグだけを返します。
このときも`result`は`jukyo`で、`message`に番地を読み取れなかったと書きます。

### `segments`の項目

| 項目 | 内容 |
|---|---|
| `value` | 区切りの文字列。 |
| `role` | 区切りの役割を表す英字の識別子。値は後の表のとおりです。 |
| `tagged` | その区切りが、どれかの候補のタグになったかどうか。 |

`role`の値は次のとおりです。
OSMのタグのキーに対応するものは、キーから`addr:`を除いた名前です。

| `role` | 内容 | 対応するタグ |
|---|---|---|
| `postcode` | 郵便番号 | `addr:postcode` |
| `prefecture` | 都道府県 | `addr:province` |
| `county` | 郡 | `addr:county` |
| `city` | 市区町村 | `addr:city` |
| `ward` | 政令指定都市の区 | `addr:suburb` |
| `quarter` | 大字 | `addr:quarter` |
| `neighbourhood` | 町字、字 | `addr:neighbourhood` |
| `block_number` | 街区符号 | `addr:block_number` |
| `housenumber` | 住居番号 | `addr:housenumber` |
| `number_undecided` | 住居表示の街区符号と住居番号か、地番か、決められない番地 | 候補によって異なる |
| `chiban` | 地番 | 無し（タグにしません） |
| `extra_number` | 番地の3つ目以降の要素 | 無し（タグにしません） |
| `unlisted_place` | 町字と地番の間にある、台帳に無い字名や通称 | 無し（タグにしません） |
| `remainder` | 建物名や階数などの残り | 無し（タグにしません） |

### `candidates`の項目

| 項目 | 内容 |
|---|---|
| `kind` | 候補の種類。値は後の表のとおりです。 |
| `tags` | OSMのタグのキーと値の組。キーは`addr:postcode`、`addr:province`から`addr:housenumber`までの順に並び、最後が`addr:full`です。 |
| `guessed` | 住居表示と推測した候補のとき、真。推測でなければ項目ごと省きます。 |
| `optionalTags` | 番地の後ろの文字列から推測した、`addr:housename`、`addr:floor`、`addr:unit`のうち推測できたもの。無いときは項目ごと省きます。 |
| `note` | 人に見せる注記（日本語）。無いときは項目ごと省きます。 |

`kind`の値は次のとおりです。

| 値 | 意味 |
|---|---|
| `jukyo` | 住居表示の候補。番地まで含みます。 |
| `chiban` | 地番の候補。番地は含まず、町字までで止めます。 |
| `town` | 住居表示か地番かを決める材料が無く、町字までで止めた候補。国土数値情報由来の町字で、台帳に番地の明細が無いときに返します。 |

候補の見出し（「住居表示の場合」など）は、APIでは返しません。
`kind`と`result`から、呼び出し側で作ってください。

`addr:full`は、貼った住所を正規化した文字列です。
郵便番号は除き、番地の後ろの建物名、階、部屋番号は残します。
どの候補にも同じ値が入ります。
地番の住所でも番地を含みますが、番地の値は地番の台帳のレコードからではなく、貼られた文字列から取ります。

`optionalTags`は、`tags`に足すかどうかを呼び出し側が決めるための候補です。
どの候補にも同じ値が入ります。
推測の精度は高くないので、利用者が選んでから使ってください。

返すタグには、`addr:country`、`note`、`fixme`、`name`を入れません。

## 誤りの応答

| 状態 | HTTPの状態コード | `error.code` |
|---|---|---|
| JSONとして読めない、`address`が無い、空、文字列でない | 400 | `bad_request` |
| `address`が200文字を超える、または本文が8KBを超える | 413 | `too_long` |
| 回数の制限を超えた | 429 | `rate_limited` |
| パスが無い | 404 | `not_found` |
| `/api/v1/parse`にPOSTとOPTIONS以外で要求した | 405 | `method_not_allowed` |
| サーバ内部の失敗 | 500 | `internal` |

本文は次の形です。

```json
{"error": {"code": "bad_request", "message": "住所を文字列で指定してください。"}}
```

`message`は人に見せるための日本語で、文面は変わることがあります。
プログラムは`error.code`で分岐してください。
429には、待つ秒数を示す`Retry-After`ヘッダを付けます。
405には、使える方法を示す`Allow`ヘッダを付けます。

## 版と互換

パスに版（`v1`）を入れています。
同じ版の中では、項目や`role`、`result`、`kind`の値を足すことはあっても、消したり意味を変えたりしません。
呼び出し側のプログラムは、知らない項目と知らない値を読み飛ばしてください。
たとえば、知らない`role`の区切りは無視し、知らない`kind`の候補は表示しないようにします。
消す変更や意味を変える変更は、`/api/v2/`として出します。

## 利用の条件

回数の制限は、送り元のIPアドレスごとに、1分あたり60回が既定です。
サーバの運用者が変えられます。
上限を超えると429を返します。

CORSを許可しています（`Access-Control-Allow-Origin: *`）。
ブラウザで動くツールから直接呼べます。
`OPTIONS`の事前確認にも答えます。

## 住所の扱い

分けられなかった住所（町字を特定できなかったもの、正規化が失敗したもの）は、分割の改善のために、サーバに記録します。
分けられた住所は、記録しません。

返すタグには、アドレス・ベース・レジストリ（デジタル庁）と位置参照情報（国土交通省）を加工したデータに由来する値が含まれます。
出典の書き方は、README.mdの「出力される住所データ」の節にあります。

座標は返しません。
地番の台帳から取った番地は、タグ（`addr:full`を含む）にして返しません。
